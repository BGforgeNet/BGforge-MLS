/**
 * Runs the TSSL compiler on a worker thread.
 *
 * A compile is around 700 ms of straight-line CPU, almost all of it inside TypeScript's own parser and
 * binder, and validation runs while the user types - so on the server's own thread it would stall every
 * other request for that whole time. The SSL back end is here for the same reason; see
 * `../fallout-ssl/compile-worker.ts`.
 *
 * The ts-morph project is built once and kept, because standing one up is what that 700 ms buys: after
 * the first compile the same document recompiles in tens of milliseconds. Requests are serialised
 * behind one another, since they all mutate that project.
 */

import * as fs from "fs";
import { parentPort } from "worker_threads";
import { emitProgram } from "../../../compilers/ssl/src/compile";
import { optimize } from "../../../compilers/ssl/src/optimize";
import { createBatchState } from "../../../compilers/tssl/src/batch";
import { transpile } from "../../../compilers/tssl/src/index";
import { lowerTsslProgram } from "../../../compilers/tssl/src/int/lower";
import { TranspileError } from "../../../transpilers/common/transpile-error";
import type { CompileFailure, CompileRequest, CompileResponse } from "./compile-worker-protocol";

const batch = createBatchState();

/**
 * Compiles one request and writes what it asked for. Exported so the compile can be tested without a
 * thread: everything below is message plumbing, and everything a caller cares about is here.
 */
export async function runTsslCompile(request: CompileRequest): Promise<void> {
    const options = { level: request.level, shortCircuit: request.shortCircuit };
    // `emitProgram` rather than the raw emitter: it reconciles the level with a `#pragma sce` and with
    // whether the optimiser removed the fall-through epilogue.
    const bytes = emitProgram(optimize(lowerTsslProgram(request.filepath, request.text, batch), options), options);
    if (request.intPath !== null) {
        await fs.promises.writeFile(request.intPath, bytes);
    }
    if (request.sslPath === null) return;

    // Written from the source rather than from the IR above, which has already been desugared and
    // optimised: rendering that back would compile to the same bytes but no longer read like the script
    // the author wrote.
    const ssl = await transpile(request.filepath, request.text, batch);
    await fs.promises.writeFile(request.sslPath, ssl, "utf-8");
}

function failureOf(error: unknown): CompileFailure {
    const location = error instanceof TranspileError ? error.location : {};
    return {
        message: error instanceof Error ? error.message : String(error),
        ...location,
    };
}

// One project, so one compile at a time. Each request waits for the one before it rather than
// interleaving its own edits to that project with another's.
let queue: Promise<void> = Promise.resolve();

parentPort?.on("message", (request: CompileRequest) => {
    queue = queue.then(async () => {
        let failure: CompileFailure | undefined;
        try {
            await runTsslCompile(request);
        } catch (error) {
            failure = failureOf(error);
        }
        const response: CompileResponse = failure ? { id: request.id, failure } : { id: request.id };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker port's postMessage takes no origin; the rule is about window.postMessage.
        parentPort?.postMessage(response);
    });
});
