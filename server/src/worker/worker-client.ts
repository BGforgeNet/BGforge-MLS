/**
 * The server's side of a worker thread: everything that is the same whichever worker it is.
 *
 * Starting one and keeping it, matching replies to requests by id, bounding a request so a wedged
 * worker reports instead of hanging, failing everything in flight when the thread dies, and not holding
 * the process open - none of that is specific to what the worker computes. It was written twice, once
 * per worker, and the second copy came from the first.
 *
 * What stays with each worker is the part that reads its own protocol: which response field carries the
 * answer, and how a refusal becomes the error its callers expect.
 *
 * `../fallout-ssl/compile-worker-client.ts` is the same shape and deliberately has not adopted this: it
 * carries no timeout today, so moving it here would add one, which is a behaviour change rather than a
 * refactor. It is the obvious third caller whenever that change is wanted on its own terms.
 */

import * as path from "path";
import { Worker } from "worker_threads";
import { conlog } from "../logger";

/** The shape this needs of any request and response: an id to match them by. */
interface Identified {
    id: number;
}

interface Pending<Res> {
    resolve: (response: Res | null) => void;
    reject: (error: Error) => void;
    settle: () => void;
}

export interface WorkerClientOptions {
    /** Bundle name beside the server bundle; both are emitted into `server/out` by the same build. */
    fileName: string;
    /**
     * Names the worker in the errors a caller sees - "The TSSL compiler did not answer within 60s."
     * It reaches the author, so it reads as the thing they invoked rather than as a thread.
     */
    label: string;
    /**
     * How long one request may take before the worker is presumed wedged. A hang detector, not a
     * budget: set it well above the slowest real request so it only fires on a genuine stall.
     */
    timeoutMs: number;
}

export interface WorkerClient<Req extends Identified, Res extends Identified> {
    /**
     * Sends one request and resolves with the worker's raw response - `null` when `signal` fires first,
     * which is a caller displacing its own earlier request rather than a failure. Rejects only when the
     * round trip itself fails: a dead worker, a timeout, a request that could not be posted. A refusal
     * by the worker arrives as a response for the caller to interpret.
     */
    send: (request: Omit<Req, "id">, signal?: AbortSignal) => Promise<Res | null>;
    /** Starts the worker without sending anything, so its bundle is evaluated before the first request. */
    start: () => void;
    /** Drops the worker, failing everything in flight rather than holding a shutdown open for it. */
    stop: () => Promise<void>;
}

export function createWorkerClient<Req extends Identified, Res extends Identified>(
    options: WorkerClientOptions,
): WorkerClient<Req, Res> {
    const { fileName, label, timeoutMs } = options;
    const workerPath = path.join(__dirname, fileName);

    const worker: { instance: Worker | null } = { instance: null };
    const pending = new Map<number, Pending<Res>>();
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

        const instance = new Worker(workerPath);
        instance.on("message", (response: Res) => {
            const entry = pending.get(response.id);
            pending.delete(response.id);
            // Gone means the request was displaced or timed out; the worker finished it anyway, having
            // no way to be told otherwise, and its answer is what nobody is waiting for.
            if (!entry) return;
            entry.settle();
            entry.resolve(response);
        });
        // A worker that dies takes every request in flight with it. They are rejected rather than left
        // hanging, and the reference is dropped so the next request starts a fresh one.
        instance.on("error", (error: Error) => {
            conlog(`${label} worker error: ${error.message}`);
            worker.instance = null;
            failAllPending(`The ${label} failed to run: ${error.message}`);
        });
        instance.on("exit", (code) => {
            worker.instance = null;
            if (pending.size > 0) failAllPending(`The ${label} stopped unexpectedly (exit ${code}).`);
        });
        // The worker must not hold the server open: it is idle between requests, and the process should
        // be free to exit whenever everything else is done.
        instance.unref();

        worker.instance = instance;
        return instance;
    }

    function send(request: Omit<Req, "id">, signal?: AbortSignal): Promise<Res | null> {
        const id = nextId++;
        return new Promise<Res | null>((resolve, reject) => {
            if (signal?.aborted) {
                resolve(null);
                return;
            }

            const timer = setTimeout(() => {
                pending.delete(id);
                signal?.removeEventListener("abort", onAbort);
                reject(new Error(`The ${label} did not answer within ${timeoutMs / 1000}s.`));
            }, timeoutMs);
            // The worker is idle between requests and must not hold the process open; neither may this.
            timer.unref?.();

            function onAbort(): void {
                pending.delete(id);
                clearTimeout(timer);
                resolve(null);
            }
            signal?.addEventListener("abort", onAbort, { once: true });

            const settle = (): void => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
            };

            pending.set(id, { resolve, reject, settle });
            try {
                // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin; the rule is about window.postMessage.
                getWorker().postMessage({ ...request, id });
            } catch (error) {
                pending.delete(id);
                settle();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    return {
        send,
        start: () => {
            getWorker();
        },
        stop: async () => {
            const instance = worker.instance;
            worker.instance = null;
            failAllPending(`The ${label} was shut down.`);
            if (instance) await instance.terminate();
        },
    };
}
