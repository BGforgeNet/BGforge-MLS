/**
 * The server's side of the TSSL compile worker.
 *
 * One worker is started on the first compile and kept: it holds the ts-morph project, which costs more
 * to build than every compile after the first one takes to run. It is torn down on shutdown, and
 * replaced by the next request if it ever dies.
 */

import * as path from "path";
import { Worker } from "worker_threads";
import { TranspileError } from "../../../transpilers/common/transpile-error";
import { conlog } from "../logger";
import type { CompileRequest, CompileResponse } from "./compile-worker-protocol";

/** Sits beside the server bundle; both are emitted into `server/out` by the same build. */
const WORKER_PATH = path.join(__dirname, "tssl-compile-worker.js");

/**
 * How long one compile may take before the worker is presumed wedged.
 *
 * A first compile stands up the TypeScript program and runs about a second; every one after it is well
 * under 100 ms. The bound is a hang detector, not a budget - generous enough that a cold compile on a
 * loaded machine never trips it, and short enough that a wedged worker reports instead of leaving the
 * document's diagnostics pinned forever.
 */
const COMPILE_TIMEOUT_MS = 60_000;

interface Pending {
    /** `true` when the worker wrote what was asked for, `false` when a newer compile displaced this one. */
    resolve: (completed: boolean) => void;
    reject: (error: Error) => void;
    settle: () => void;
}

const worker: { instance: Worker | null } = { instance: null };
const pending = new Map<number, Pending>();
let nextId = 0;
let prewarmed = false;

/**
 * The entry a prewarm compiles. It imports nothing, because the two costs reachable before a document
 * is open are ts-morph's module eval and binding the lib set; the author's own dependencies resolve
 * from their project, which is not known yet. The path is never read - it only tells module resolution
 * where to resolve from, and nothing here resolves.
 */
const PREWARM_SOURCE = "function start() {}\n";
const PREWARM_PATH = path.join(__dirname, "__prewarm__.tssl");

function failAllPending(reason: string): void {
    for (const [, entry] of pending) {
        entry.settle();
        entry.reject(new Error(reason));
    }
    pending.clear();
}

function getWorker(): Worker {
    if (worker.instance) return worker.instance;

    const instance = new Worker(WORKER_PATH);
    instance.on("message", (response: CompileResponse) => {
        const entry = pending.get(response.id);
        pending.delete(response.id);
        // Gone means the request was displaced or timed out; the worker finished it anyway, having no
        // way to be told otherwise, and its answer is what nobody is waiting for.
        if (!entry) return;
        entry.settle();
        const failure = response.failure;
        if (failure === undefined) {
            entry.resolve(true);
            return;
        }
        // Rebuilt rather than forwarded: the clone that crossed the thread boundary is plain data, and
        // the caller reports a refusal by reading the location off a TranspileError.
        const { message, ...location } = failure;
        entry.reject(new TranspileError(message, location));
    });
    // A worker that dies takes every request in flight with it. They are rejected rather than left
    // hanging, and the reference is dropped so the next compile starts a fresh one.
    instance.on("error", (error: Error) => {
        conlog(`TSSL compile worker error: ${error.message}`);
        worker.instance = null;
        failAllPending(`The TSSL compiler failed to run: ${error.message}`);
    });
    instance.on("exit", (code) => {
        worker.instance = null;
        if (pending.size > 0) failAllPending(`The TSSL compiler stopped unexpectedly (exit ${code}).`);
    });
    // The worker must not hold the server open: it is idle between compiles, and the process should be
    // free to exit whenever everything else is done.
    instance.unref();

    worker.instance = instance;
    return instance;
}

/**
 * Compiles on the worker thread.
 *
 * Resolves `true` once the requested files are written, `false` when `signal` fires because a newer
 * compile of the same document displaced this one - a displaced compile is not a failure and has
 * nothing to report. Rejects on a refusal, on the worker dying, and on the timeout above.
 */
export function compileOnWorker(request: Omit<CompileRequest, "id">, signal?: AbortSignal): Promise<boolean> {
    const id = nextId++;
    return new Promise<boolean>((resolve, reject) => {
        if (signal?.aborted) {
            resolve(false);
            return;
        }

        const timer = setTimeout(() => {
            pending.delete(id);
            signal?.removeEventListener("abort", onAbort);
            reject(new Error(`The TSSL compiler did not answer within ${COMPILE_TIMEOUT_MS / 1000}s.`));
        }, COMPILE_TIMEOUT_MS);
        // The worker is idle between compiles and must not hold the process open; neither may this.
        timer.unref?.();

        function onAbort(): void {
            pending.delete(id);
            clearTimeout(timer);
            resolve(false);
        }
        signal?.addEventListener("abort", onAbort, { once: true });

        const settle = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        };

        pending.set(id, { resolve, reject, settle });
        try {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin; the rule is about window.postMessage.
            getWorker().postMessage({ ...request, id } satisfies CompileRequest);
        } catch (error) {
            pending.delete(id);
            settle();
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

/**
 * Builds the worker's project before the first compile asks for it.
 *
 * Started lazily, the first compile stands the TypeScript program up inside the author's request:
 * ts-morph module eval and binding `lib.es2022.d.ts` measured at 249 ms and 132 ms of a 698 ms first
 * compile. Compiling a throwaway entry here moves both onto a thread nobody is waiting on. Nothing is
 * awaited, and both output paths are null, so the compile runs in full and writes nothing.
 *
 * A real compile arriving meanwhile queues behind this one in the worker, which costs it only the
 * throwaway's own lowering: the setup it waits through is the setup it would otherwise have paid for
 * itself.
 */
export function prewarmTsslCompileWorker(): void {
    if (prewarmed) return;
    prewarmed = true;
    void compileOnWorker({
        text: PREWARM_SOURCE,
        filepath: PREWARM_PATH,
        intPath: null,
        sslPath: null,
        level: 0,
        shortCircuit: false,
    }).catch((error: unknown) => {
        // Nobody asked for this compile, so a refusal is not the author's to see. It is still logged:
        // a worker that cannot start would otherwise show up only as a slow first compile.
        conlog(`TSSL compile worker prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

/** Stops the worker, so a shutdown is not held up by a compile the result of which nobody wants. */
export async function stopTsslCompileWorker(): Promise<void> {
    const instance = worker.instance;
    worker.instance = null;
    // The next worker starts cold, so it needs the prewarm this one already had.
    prewarmed = false;
    failAllPending("The TSSL compiler was shut down.");
    if (instance) await instance.terminate();
}
