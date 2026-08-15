/**
 * Turns what the SSL compiler threw into diagnostics the editor can place.
 *
 * Lives apart from the worker that calls it so it can be exercised without starting a thread: it is a
 * pure function of an error and the path it came from, and every interesting case is a refusal shape
 * rather than anything about threading.
 */

import { CompileError } from "../../../compilers/ssl/src/compile";
import { LowerError } from "../../../compilers/ssl/src/lower";
import { PreprocessError } from "../../../compilers/ssl/src/preprocess";
import { pathToUri } from "../uri-utils";
import type { Diagnostic } from "./compile-worker-protocol";

/**
 * Turns a compiler error into diagnostics, reading the `line:column:` prefix the front end puts on the
 * ones it can locate. A preprocessor error names its own file, which may be an included header rather
 * than the script being compiled.
 *
 * A `CompileError` carries every problem the compile found, so all of them are shown at once; anything
 * else is a single refusal and reports as one. This runs here rather than on the server's thread
 * because an Error subclass does not survive the structured clone between them - only plain data does.
 */
export function toDiagnostics(error: unknown, sourcePath: string): Diagnostic[] {
    if (error instanceof PreprocessError) {
        // Each keeps its own file: a header included from this script reports against the header, which
        // is the file the user has to open to fix it.
        return error.all.map((one) => ({
            uri: pathToUri(one.file),
            line: one.line,
            columnStart: 0,
            columnEnd: 0,
            message: one.message,
        }));
    }
    if (error instanceof CompileError && error.diagnostics.length > 0) {
        return error.diagnostics.map((diagnostic) => ({
            uri: pathToUri(sourcePath),
            line: diagnostic.line,
            columnStart: 0,
            columnEnd: diagnostic.column,
            message: diagnostic.message,
        }));
    }
    if (error instanceof LowerError) {
        return error.all.map((one) => ({
            uri: pathToUri(sourcePath),
            line: one.line,
            columnStart: 0,
            columnEnd: one.column,
            message: one.detail,
        }));
    }
    const message = error instanceof Error ? error.message : String(error);
    const located = /^(\d+):(\d+): (.*)$/s.exec(message);
    return [
        {
            uri: pathToUri(sourcePath),
            line: located ? Number(located[1]) : 1,
            columnStart: 0,
            columnEnd: located ? Number(located[2]) : 0,
            message: located ? located[3]! : message,
        },
    ];
}
