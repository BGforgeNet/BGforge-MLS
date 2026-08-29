/**
 * The server's side of the SSL compile worker: what is specific to the SSL compile protocol.
 *
 * The thread, the id matching, the timeout and the teardown are `../worker/worker-client.ts`, shared
 * with the TSSL compiler and the transpiler. What is here is reading this protocol's response, which
 * carries the diagnostics directly rather than a refusal.
 *
 * One worker is started on the first compile and kept: it holds a loaded grammar, which costs more to
 * build than a typical compile takes to run. Unlike the other two it has its own bundle, because it
 * carries a tree-sitter grammar rather than ts-morph and shares nothing with them.
 */

import { createWorkerClient } from "../worker/worker-client";
import type { CompileRequest, CompileResponse, Diagnostic } from "./compile-worker-protocol";

/**
 * Bounds one compile. A hang detector, not a budget: this worker runs synchronous JS - a tree-sitter
 * parse and the compiler - so a wedged one emits no message, no error and no exit, and without this the
 * compile never settles and the document's diagnostics stay pinned with nothing reported. Sized well
 * above any real compile so a loaded machine cannot trip it.
 */
const COMPILE_TIMEOUT_MS = 60_000;

/** What one compile produced: what stops it, and what is only worth mentioning. */
export interface CompileOutcome {
    errors: Diagnostic[];
    warnings: Diagnostic[];
}

const client = createWorkerClient<CompileRequest, CompileResponse>({
    fileName: "compile-worker.js",
    label: "SSL compiler",
    timeoutMs: COMPILE_TIMEOUT_MS,
});

/** Compiles on the worker thread and resolves with whatever the editor should show. */
export async function compileOnWorker(request: Omit<CompileRequest, "id">): Promise<CompileOutcome> {
    const response = await client.send(request);
    // Never null: only an abort signal produces one, and no caller here passes one. Asserted rather
    // than handled so a future caller that does pass one has to say what it means.
    if (response === null) throw new Error("The SSL compiler request was cancelled.");
    return { errors: response.errors, warnings: response.warnings };
}

/** Stops the worker, so a shutdown is not held up by a compile the result of which nobody wants. */
export async function stopCompileWorker(): Promise<void> {
    await client.stop();
}
