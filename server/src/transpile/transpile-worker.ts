/**
 * The TD and TBAF transpilers, on their own thread.
 *
 * `server/src/compile.ts` called these directly, which put ts-morph and both transpilers on the server
 * thread: 80% of the server bundle, and a 51-60 ms cold stall per save (10-24 ms warm) on the thread
 * that answers hover and completion. Only the transpile call moves here - writing the output, showing
 * the notification, relocating diagnostics and handing off to WeiDU all stay with the caller, because
 * the transpilers are pure `(path, text) -> result` and nothing downstream of them needs a thread.
 *
 * The thread and its message loop live in `../worker/ts-morph-worker.ts`, which serves this and the
 * TSSL compiler from one bundle so ts-morph ships once rather than once per entry point. The
 * equivalence with an in-process transpile is what `transpile-worker.test.ts` pins, and
 * `transpile-worker-smoke.test.ts` is what proves the built bundle loads and answers.
 */

import { td, tbafWithSourceMap, TranspileError } from "../../../transpilers/src/index";
import { parseTDSource } from "../td/dialog-source";
import { parseTSSLSource } from "../tssl/dialog-source";
import type { TranspileFailure, TranspileRequest, TranspileResponse } from "./transpile-worker-protocol";

export async function runTranspile(request: TranspileRequest): Promise<TranspileResponse> {
    try {
        switch (request.kind) {
            case "td": {
                const { output, warnings, sourceMap } = await td(request.filepath, request.text);
                return { id: request.id, result: { output, warnings, sourceMap } };
            }
            case "tbaf": {
                const { output, sourceMap } = await tbafWithSourceMap(request.filepath, request.text);
                // TBAF reports no orphan warnings; the empty array keeps one result shape for both.
                return { id: request.id, result: { output, warnings: [], sourceMap } };
            }
            case "parse-td":
                return { id: request.id, parsed: parseTDSource(request.text) };
            case "parse-tssl":
                // The set arrives with the request; see the protocol for why the worker cannot build it.
                return { id: request.id, parsed: parseTSSLSource(request.text, new Set(request.sideEffectFns)) };
        }
    } catch (error) {
        return { id: request.id, failure: failureOf(error) };
    }
}

function failureOf(error: unknown): TranspileFailure {
    const location = error instanceof TranspileError ? error.location : {};
    return {
        message: error instanceof Error ? error.message : String(error),
        ...location,
    };
}
