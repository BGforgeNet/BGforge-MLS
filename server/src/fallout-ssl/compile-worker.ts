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
import { compileSource } from "../../../compilers/ssl/src/compile";
import { getParser as getSSLParser, initParser as initSSLParser } from "../../../shared/parsers/fallout-ssl";
import { pathToUri } from "../uri-utils";
import { problemDiagnostics } from "./compile-diagnostics";
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
    // `filepath` is never read: it fixes where a quoted `#include` looks and which file an error names,
    // so an unsaved buffer compiles exactly as the saved file would. The compiler reports by value and in
    // source coordinates; nothing here catches or flattens a refusal.
    const result = compileSource(parser, request.text, request.filepath, {
        preprocess: { includeDirs: request.includeDirs, defines: request.defines },
        level: request.level,
        shortCircuit: request.shortCircuit,
        noWarnings: request.noWarnings,
    });
    const problems = [...result.problems];
    if (result.bytes) {
        try {
            // Written here rather than posted back: the bytes are the only large payload in the exchange,
            // and the server's thread has no use for them.
            fs.writeFileSync(request.dstPath, result.bytes);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            problems.push({ line: 1, column: 0, message });
        }
    }
    // Whatever was found before a failure still stands, so the warnings go back with the errors.
    return {
        errors: problemDiagnostics(problems, request.filepath),
        // A warning knows where it is but not how wide: its range is the single (0-based) column it
        // names, where an error underlines from the line start - the convention each has always had.
        warnings: result.warnings.map((warning) => ({
            uri: pathToUri(warning.file ?? request.filepath),
            line: warning.line,
            columnStart: Math.max(0, warning.column - 1),
            columnEnd: Math.max(0, warning.column - 1),
            message: warning.message,
        })),
    };
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
