/**
 * The server's side of the TSSL compile worker: what is specific to the compile protocol.
 *
 * The thread, the id matching, the timeout and the teardown are `../worker/worker-client.ts`, shared
 * with the transpiler. What is here is adding the `kind` that selects the compiler half of that shared
 * bundle, rebuilding a refusal as the positioned error a caller reports from, and the startup prewarm.
 *
 * One worker is started by the first open of a .tssl document (`prewarmWorkerFor` in
 * handlers/document-lifecycle.ts) and kept: it holds the ts-morph project, which costs more to build
 * than every compile after the first one takes to run. Its bundle is shared with the transpile worker,
 * which runs a second instance; the two stay separate instances so a dialog parse never queues behind a
 * first compile.
 */

import * as path from "path";
import { TranspileError } from "../../../transpilers/common/transpile-error";
import { conlog } from "../logger";
import { createWorkerClient } from "../worker/worker-client";
import type { CompileRequest, CompileResponse } from "./compile-worker-protocol";

/**
 * Bounds one compile. A first compile stands the TypeScript program up and runs ~690 ms; every one
 * after it is well under 100 ms. A hang detector, not a budget - generous enough that a cold compile on
 * a loaded machine never trips it, short enough that a wedged worker reports instead of leaving the
 * document's diagnostics pinned forever.
 */
const COMPILE_TIMEOUT_MS = 60_000;

const client = createWorkerClient<CompileRequest, CompileResponse>({
    // Shared with the transpiler's client, which runs its own instance of the same bundle.
    fileName: "ts-morph-worker.js",
    label: "TSSL compiler",
    timeoutMs: COMPILE_TIMEOUT_MS,
});

let prewarmed = false;

/**
 * The entry a prewarm compiles. It imports nothing, because the two costs reachable before a document
 * is open are ts-morph's module eval and binding the lib set; the author's own dependencies resolve
 * from their project, which is not known yet. The path is never read - it only tells module resolution
 * where to resolve from, and nothing here resolves.
 */
const PREWARM_SOURCE = "function start() {}\n";
const PREWARM_PATH = path.join(__dirname, "__prewarm__.tssl");

/**
 * Compiles on the worker thread.
 *
 * Resolves `true` once the requested files are written, `false` when `signal` fires because a newer
 * compile of the same document displaced this one - a displaced compile is not a failure and has
 * nothing to report. Rejects on a refusal, on the worker dying, and on the timeout above.
 *
 * `kind` is added here rather than asked of every caller: it exists so one bundle can serve both
 * workers, which is transport, not something a compile site has an opinion on.
 */
export async function compileOnWorker(
    request: Omit<CompileRequest, "id" | "kind">,
    signal?: AbortSignal,
): Promise<boolean> {
    const response = await client.send({ ...request, kind: "compile" }, signal);
    if (response === null) return false;
    if (response.failure) {
        // Rebuilt rather than forwarded: the clone that crossed the thread boundary is plain data, and
        // the caller reports a refusal by reading the location off a TranspileError.
        const { message, ...location } = response.failure;
        throw new TranspileError(message, location);
    }
    return true;
}

/**
 * Builds the worker's project before the first compile asks for it.
 *
 * Started lazily, the first compile stands the TypeScript program up inside the author's request:
 * ts-morph module eval and binding `lib.es2022.d.ts` measured at 254 ms and 119 ms of a 688 ms first
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
    // The next worker starts cold, so it needs the prewarm this one already had.
    prewarmed = false;
    await client.stop();
}
