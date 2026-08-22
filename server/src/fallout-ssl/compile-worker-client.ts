/**
 * The server's side of the SSL compile worker.
 *
 * One worker is started on the first compile and kept: it holds a loaded grammar, which costs more to
 * build than a typical compile takes to run. It is torn down on shutdown, and replaced by the next
 * request if it ever dies.
 */

import * as path from "path";
import { Worker } from "worker_threads";
import { conlog } from "../logger";
import type { CompileRequest, CompileResponse, Diagnostic } from "./compile-worker-protocol";

/** Sits beside the server bundle; both are emitted into `server/out` by the same build. */
const WORKER_PATH = path.join(__dirname, "compile-worker.js");

/** What one compile produced: what stops it, and what is only worth mentioning. */
export interface CompileOutcome {
    errors: Diagnostic[];
    warnings: Diagnostic[];
}

interface Pending {
    resolve: (outcome: CompileOutcome) => void;
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
        pending.get(response.id)?.resolve({ errors: response.errors, warnings: response.warnings });
        pending.delete(response.id);
    });
    // A worker that dies takes every request in flight with it. They are rejected rather than left
    // hanging, and the reference is dropped so the next compile starts a fresh one.
    instance.on("error", (error: Error) => {
        conlog(`SSL compile worker error: ${error.message}`);
        worker.instance = null;
        failAllPending(`The SSL compiler failed to run: ${error.message}`);
    });
    instance.on("exit", (code) => {
        worker.instance = null;
        if (pending.size > 0) failAllPending(`The SSL compiler stopped unexpectedly (exit ${code}).`);
    });
    // The worker must not hold the server open: it is idle between compiles, and the process should be
    // free to exit whenever everything else is done.
    instance.unref();

    worker.instance = instance;
    return instance;
}

/** Compiles on the worker thread and resolves with whatever the editor should show. */
export function compileOnWorker(request: Omit<CompileRequest, "id">): Promise<CompileOutcome> {
    const id = nextId++;
    return new Promise<CompileOutcome>((resolve, reject) => {
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
export async function stopCompileWorker(): Promise<void> {
    const instance = worker.instance;
    worker.instance = null;
    failAllPending("The SSL compiler was shut down.");
    if (instance) await instance.terminate();
}
