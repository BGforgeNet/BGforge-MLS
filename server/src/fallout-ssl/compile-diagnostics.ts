/**
 * Turns what the SSL compiler threw into diagnostics the editor can place.
 *
 * Lives apart from the worker that calls it so it can be exercised without starting a thread: it is a
 * pure function of an error and the path it came from, and every interesting case is a refusal shape
 * rather than anything about threading.
 *
 * Reading the error is `problemsOf`'s job, in the compiler package, because the compiled-script editor
 * in the client needs the same reading and must not reach into the server for it. What is left here is
 * the part that is the server's: attaching a URI, and the protocol's column convention.
 */

import { problemsOf } from "../../../compilers/ssl/src/problems";
import { pathToUri } from "../uri-utils";
import type { Diagnostic } from "./compile-worker-protocol";

/**
 * Turns a compiler error into diagnostics. A preprocessor error names its own file, which may be an
 * included header rather than the script being compiled; everything else reports against the script.
 *
 * This runs here rather than on the server's thread because an Error subclass does not survive the
 * structured clone between them - only plain data does.
 */
export function toDiagnostics(error: unknown, sourcePath: string): Diagnostic[] {
    return problemsOf(error).map((problem) => ({
        // Each keeps its own file: a header included from this script reports against the header, which
        // is the file the user has to open to fix it.
        uri: pathToUri(problem.file ?? sourcePath),
        line: problem.line,
        columnStart: 0,
        columnEnd: problem.column,
        message: problem.message,
    }));
}
