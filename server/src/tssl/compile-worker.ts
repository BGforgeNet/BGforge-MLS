/**
 * The TSSL compiler's side of the shared ts-morph worker.
 *
 * A first compile is ~690 ms of straight-line CPU, two thirds of it standing the TypeScript program up
 * rather than compiling - and validation runs while the user types, so on the server's own thread it
 * would stall every other request for that whole time. The SSL back end is off-thread for the same
 * reason; see `../fallout-ssl/compile-worker.ts`.
 *
 * The ts-morph project is built once and kept, because standing one up is what that time buys: after
 * the first compile the same document recompiles in under 100 ms. `prewarmTsslCompileWorker` pays it at
 * server start instead of inside the author's first compile.
 *
 * The thread and its message loop live in `../worker/ts-morph-worker.ts`, which serves this and the
 * transpilers from one bundle so ts-morph ships once rather than once per entry point.
 */

import * as fs from "fs";
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

    // Written from the source rather than from the IR above, which has already been desugared and
    // optimised: rendering that back would compile to the same bytes but no longer read like the script
    // the author wrote.
    //
    // Produced BEFORE either file is written, because the two routes do not refuse the same programs -
    // the emitter rejects a name the bytecode front end accepts. Writing as we went left a fresh `.int`
    // beside a reported failure, which reads as a compile that succeeded.
    const ssl = request.sslPath === null ? null : await transpile(request.filepath, request.text, batch);

    if (request.intPath !== null) {
        await fs.promises.writeFile(request.intPath, bytes);
    }
    if (request.sslPath !== null && ssl !== null) {
        await fs.promises.writeFile(request.sslPath, ssl, "utf-8");
    }
}

function failureOf(error: unknown): CompileFailure {
    const location = error instanceof TranspileError ? error.location : {};
    return {
        message: error instanceof Error ? error.message : String(error),
        ...location,
    };
}

/** Runs one compile and answers with what the caller reports from. The shared entry does the posting. */
export async function handleCompile(request: CompileRequest): Promise<CompileResponse> {
    try {
        await runTsslCompile(request);
        return { id: request.id };
    } catch (error) {
        return { id: request.id, failure: failureOf(error) };
    }
}
