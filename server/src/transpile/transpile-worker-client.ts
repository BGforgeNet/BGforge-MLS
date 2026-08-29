/**
 * The server's side of the transpile worker.
 *
 * One worker is started and kept, for the reason the TSSL compile worker's client gives: the cost is
 * standing the thread and ts-morph up (~400 ms: ~36 ms spawn, ~367 ms evaluating the bundle), not the
 * transpile itself. Unlike that client, this one can be started before anything asks for it -
 * `prewarmTranspileWorker` is called at server start, so the eval happens on a thread nobody is
 * waiting on rather than inside the author's first save.
 *
 * A warm round-trip costs 0.06 ms empty and 0.46 ms for a 200-record result, against a transpile of
 * 10-60 ms, so the boundary is not where the time goes.
 */

import * as path from "path";
import { Worker } from "worker_threads";
import { TranspileError } from "../../../transpilers/common/transpile-error";
import { conlog } from "../logger";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import type { TranspileRequest, TranspileResponse, TranspileWorkerResult } from "./transpile-worker-protocol";

/**
 * Sits beside the server bundle; both are emitted into `server/out` by the same build. Shared with the
 * TSSL compiler's client, which runs its own instance of it - see `../worker/ts-morph-worker.ts`.
 */
const WORKER_PATH = path.join(__dirname, "ts-morph-worker.js");

/**
 * How long one transpile may take before the worker is presumed wedged. A hang detector, not a
 * budget: the slowest measured transpile is under 100 ms, so this only fires on a real stall.
 */
const TRANSPILE_TIMEOUT_MS = 60_000;

interface Pending {
    resolve: (response: TranspileResponse) => void;
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
    instance.on("message", (response: TranspileResponse) => {
        const entry = pending.get(response.id);
        pending.delete(response.id);
        if (!entry) return;
        entry.settle();
        entry.resolve(response);
    });
    // A worker that dies takes every request in flight with it. They are rejected rather than left
    // hanging, and the reference is dropped so the next transpile starts a fresh one.
    instance.on("error", (error: Error) => {
        conlog(`Transpile worker error: ${error.message}`);
        worker.instance = null;
        failAllPending(`The transpiler failed to run: ${error.message}`);
    });
    instance.on("exit", (code) => {
        worker.instance = null;
        if (pending.size > 0) failAllPending(`The transpiler stopped unexpectedly (exit ${code}).`);
    });
    // The worker must not hold the server open: it is idle between transpiles, and the process should
    // be free to exit whenever everything else is done.
    instance.unref();

    worker.instance = instance;
    return instance;
}

/**
 * Starts the worker so its bundle is evaluated before the first transpile asks for it.
 *
 * Called at server start. Nothing is awaited and nothing is sent: the point is only that the ~400 ms
 * of thread and module setup happens on a thread the server is not waiting on. Safe to call more than
 * once - a worker already standing is returned as-is.
 */
export function prewarmTranspileWorker(): void {
    getWorker();
}

/**
 * Sends one request and resolves with the raw response.
 *
 * Rejects only when the round-trip itself fails - a dead worker, a timeout. A refusal by the transpiler
 * arrives as a successful response carrying `failure`, and each caller rebuilds it into the error its
 * own consumer expects.
 */
function sendToWorker(request: Omit<TranspileRequest, "id">): Promise<TranspileResponse> {
    const id = nextId++;
    return new Promise<TranspileResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`The transpiler did not answer within ${TRANSPILE_TIMEOUT_MS / 1000}s.`));
        }, TRANSPILE_TIMEOUT_MS);
        // The worker is idle between transpiles and must not hold the process open; neither may this.
        timer.unref?.();

        const settle = (): void => clearTimeout(timer);

        pending.set(id, { settle, reject, resolve });

        try {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin; the rule is about window.postMessage.
            getWorker().postMessage({ ...request, id } satisfies TranspileRequest);
        } catch (error) {
            pending.delete(id);
            settle();
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

/** Runs one transpile on the worker thread, rebuilding a refusal as the error the caller expects. */
export async function transpileOnWorker(request: Omit<TranspileRequest, "id">): Promise<TranspileWorkerResult> {
    const response = await sendToWorker(request);
    if (response.failure) {
        // Rebuilt rather than forwarded: the clone that crossed the boundary is plain data, and the
        // caller reports a refusal by reading the location off a TranspileError.
        const { message, ...location } = response.failure;
        throw new TranspileError(message, location);
    }
    return response.result as TranspileWorkerResult;
}

/** Runs one dialog parse on the worker, returning the model the dialog editor receives. */
export async function parseOnWorker(request: Omit<TranspileRequest, "id">): Promise<DDialogData | SSLDialogData> {
    const response = await sendToWorker(request);
    if (response.failure) {
        const { message, ...location } = response.failure;
        throw new TranspileError(message, location);
    }
    return response.parsed as DDialogData | SSLDialogData;
}

/** Stops the worker, so a shutdown is not held up by a transpile whose result nobody wants. */
export async function stopTranspileWorker(): Promise<void> {
    const instance = worker.instance;
    worker.instance = null;
    failAllPending("The transpiler was shut down.");
    if (instance) await instance.terminate();
}
