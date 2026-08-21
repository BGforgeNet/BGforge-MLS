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

interface Pending {
    resolve: () => void;
    reject: (error: Error) => void;
}

const worker: { instance: Worker | null } = { instance: null };
const pending = new Map<number, Pending>();
let nextId = 0;

function failAllPending(reason: string): void {
    for (const [, entry] of pending) entry.reject(new Error(reason));
    pending.clear();
}

function getWorker(): Worker {
    if (worker.instance) return worker.instance;

    const instance = new Worker(WORKER_PATH);
    instance.on("message", (response: CompileResponse) => {
        const entry = pending.get(response.id);
        pending.delete(response.id);
        if (!entry) return;
        const failure = response.failure;
        if (failure === undefined) {
            entry.resolve();
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

/** Compiles on the worker thread. Resolves when the requested files are written, rejects on a refusal. */
export function compileOnWorker(request: Omit<CompileRequest, "id">): Promise<void> {
    const id = nextId++;
    return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin; the rule is about window.postMessage.
            getWorker().postMessage({ ...request, id } satisfies CompileRequest);
        } catch (error) {
            pending.delete(id);
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
