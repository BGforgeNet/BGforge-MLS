/**
 * The messages crossing between the server's thread and the SSL compile worker.
 *
 * Only plain data appears here: a structured clone drops class identity, so anything the worker wants
 * to say about a failure has to already be in this shape before it is posted.
 */

/** One problem to show in the editor, in the shape the diagnostics layer already consumes. */
export interface Diagnostic {
    uri: string;
    line: number;
    columnStart: number;
    columnEnd: number;
    message: string;
}

export interface CompileRequest {
    /** Matches a response to its request; the worker takes them one at a time but replies out of band. */
    id: number;
    /** The document's text, which may hold edits that were never saved. */
    text: string;
    /** The path that text belongs to. Never read - it resolves `#include` and names errors. */
    filepath: string;
    /** Where to write the compiled `.int`. */
    dstPath: string;
    includeDirs: string[];
    defines: Record<string, string>;
    level: 0 | 1 | 2;
    shortCircuit: boolean;
    /** `-n`: skip the checks that only produce warnings, rather than filtering them afterwards. */
    noWarnings: boolean;
}

export interface CompileResponse {
    id: number;
    errors: Diagnostic[];
    /**
     * Reported alongside a SUCCESSFUL compile as much as a failed one, which is what separates them from
     * errors: they travel with the result rather than with the exception that never happened.
     */
    warnings: Diagnostic[];
}
