/**
 * The server's side of the transpile worker: what is specific to the transpile protocol.
 *
 * The thread, the id matching, the timeout and the teardown are `../worker/worker-client.ts`, shared
 * with the compiler. What is here is reading this protocol's response - `result` for a transpile,
 * `parsed` for a dialog parse - and rebuilding a refusal as the error the caller reports from.
 *
 * The worker is started at server start rather than by the first request, so the ~400 ms of thread and
 * ts-morph setup happens on a thread nobody is waiting on. A warm round trip costs 0.06 ms empty and
 * 0.46 ms for a 200-record result, against a transpile of 10-60 ms, so the boundary is not where the
 * time goes.
 */

import { TranspileError } from "../../../transpilers/common/transpile-error";
import { createWorkerClient } from "../worker/worker-client";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import type { TranspileRequest, TranspileResponse, TranspileWorkerResult } from "./transpile-worker-protocol";

/**
 * Bounds one transpile. A hang detector, not a budget: the slowest measured transpile is under 100 ms,
 * so this only fires on a real stall.
 */
const TRANSPILE_TIMEOUT_MS = 60_000;

const client = createWorkerClient<TranspileRequest, TranspileResponse>({
    // Shared with the TSSL compiler's client, which runs its own instance of the same bundle.
    fileName: "ts-morph-worker.js",
    label: "transpiler",
    timeoutMs: TRANSPILE_TIMEOUT_MS,
});

/**
 * Sends one request and returns its response.
 *
 * Never null in practice: no caller here passes an abort signal, which is the only thing that produces
 * one. Asserted rather than handled so a future caller that does pass one has to say what it means.
 */
async function send(request: Omit<TranspileRequest, "id">): Promise<TranspileResponse> {
    const response = await client.send(request);
    if (response === null) throw new Error("The transpiler request was cancelled.");
    return response;
}

/** Rebuilt rather than forwarded: the clone that crossed the boundary is plain data, and the caller
 * reports a refusal by reading the location off a TranspileError. */
function throwIfRefused(response: TranspileResponse): void {
    if (!response.failure) return;
    const { message, ...location } = response.failure;
    throw new TranspileError(message, location);
}

/** Starts the worker so its bundle is evaluated before the first transpile asks for it. */
export function prewarmTranspileWorker(): void {
    client.start();
}

/** Runs one transpile on the worker thread, rebuilding a refusal as the error the caller expects. */
export async function transpileOnWorker(request: Omit<TranspileRequest, "id">): Promise<TranspileWorkerResult> {
    const response = await send(request);
    throwIfRefused(response);
    return response.result as TranspileWorkerResult;
}

/** Runs one dialog parse on the worker, returning the model the dialog editor receives. */
export async function parseOnWorker(request: Omit<TranspileRequest, "id">): Promise<DDialogData | SSLDialogData> {
    const response = await send(request);
    throwIfRefused(response);
    return response.parsed as DDialogData | SSLDialogData;
}

/** Stops the worker, so a shutdown is not held up by a transpile whose result nobody wants. */
export async function stopTranspileWorker(): Promise<void> {
    await client.stop();
}
