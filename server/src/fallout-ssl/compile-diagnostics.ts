/**
 * Turns the compiler's located problems into diagnostics the editor can place.
 *
 * Flattening a refusal into problems is `problemsOf`'s job, in the compiler package, and `compileSource`
 * runs it so no consumer catches anything. What is left here is the part that is the server's: attaching
 * a URI, and the protocol's column convention.
 */

import type { CompilerProblem } from "../../../compilers/ssl/src/problems";
import { pathToUri } from "../uri-utils";
import type { Diagnostic } from "./compile-worker-protocol";

/**
 * Attaches a URI to each problem. One naming its own file is in an included header rather than the
 * script being compiled, and the header is the file the user has to open to fix it.
 */
export function problemDiagnostics(problems: readonly CompilerProblem[], sourcePath: string): Diagnostic[] {
    return problems.map((problem) => ({
        uri: pathToUri(problem.file ?? sourcePath),
        line: problem.line,
        columnStart: 0,
        columnEnd: problem.column,
        message: problem.message,
    }));
}
