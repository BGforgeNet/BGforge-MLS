/**
 * Runs the extension's own SSL compiler on a worker thread.
 *
 * Compiling is several hundred milliseconds of straight-line CPU on the largest real scripts, and
 * validation runs while the user types, so doing it on the server's own thread would stall every other
 * request - hover, completion, diagnostics - for that whole time. The WebAssembly compiler avoids this
 * by being a separate process; this back end is a library, so it needs a thread of its own.
 *
 * The parser is built once at startup rather than per request: loading the grammar costs more than most
 * compiles do.
 */

import * as fs from "fs";
import { parentPort } from "worker_threads";
import { compilePreprocessed } from "../../../compilers/ssl/src/compile";
import { preprocessTextWithOrigins } from "../../../compilers/ssl/src/preprocess";
import { getParser as getSSLParser, initParser as initSSLParser } from "../../../shared/parsers/fallout-ssl";
import { pathToUri } from "../uri-utils";
import { toDiagnostics } from "./compile-diagnostics";
import type { CompileRequest, CompileResponse, Diagnostic } from "./compile-worker-protocol";

function compile(request: CompileRequest): { errors: Diagnostic[]; warnings: Diagnostic[] } {
    const parser = getSSLParser();
    if (!parser) {
        return {
            errors: [
                {
                    uri: pathToUri(request.filepath),
                    line: 1,
                    columnStart: 0,
                    columnEnd: 0,
                    message: "The SSL grammar could not be loaded.",
                },
            ],
            warnings: [],
        };
    }
    const uri = pathToUri(request.filepath);
    const warnings: Diagnostic[] = [];
    // A warning knows where it is but not how wide: the compiler reports a position, so the range is the
    // single column it names, which is what the errors from the same source do.
    const onWarning = (warning: { file?: string; line: number; column: number; message: string }) =>
        warnings.push({
            // A warning arrives in source coordinates; one restated against an included header names it.
            uri: warning.file === undefined ? uri : pathToUri(warning.file),
            line: warning.line,
            columnStart: warning.column - 1,
            columnEnd: warning.column - 1,
            message: warning.message,
        });
    try {
        // `filepath` is never read: it fixes where a quoted `#include` looks and which file an error
        // names, so an unsaved buffer compiles exactly as the saved file would.
        const source = preprocessTextWithOrigins(request.text, request.filepath, {
            includeDirs: request.includeDirs,
            defines: request.defines,
        });
        const bytes = compilePreprocessed(parser, source, request.filepath, {
            level: request.level,
            shortCircuit: request.shortCircuit,
            ...(request.noWarnings ? {} : { onWarning }),
        });
        // Written here rather than posted back: the bytes are the only large payload in the exchange,
        // and the server's thread has no use for them.
        fs.writeFileSync(request.dstPath, bytes);
        return { errors: [], warnings };
    } catch (error) {
        // Whatever was found before the failure still stands, so the warnings go back with the errors.
        return { errors: toDiagnostics(error, request.filepath), warnings };
    }
}

const ready = initSSLParser();

parentPort?.on("message", (request: CompileRequest) => {
    // Requests that arrive before the grammar finishes loading queue behind it rather than failing.
    void ready.then(() => {
        const response: CompileResponse = { id: request.id, ...compile(request) };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker port's postMessage takes no origin; the rule is about window.postMessage.
        parentPort?.postMessage(response);
    });
});
