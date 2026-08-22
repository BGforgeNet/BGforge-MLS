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

/** Stops the worker, so a shutdown is not held up by a compile the result of which nobody wants. */
export async function stopTsslCompileWorker(): Promise<void> {
    const instance = worker.instance;
    worker.instance = null;
    failAllPending("The TSSL compiler was shut down.");
    if (instance) await instance.terminate();
}
