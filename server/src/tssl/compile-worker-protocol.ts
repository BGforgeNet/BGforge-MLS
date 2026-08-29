/**
 * The messages crossing between the server's thread and the TSSL compile worker.
 *
 * Only plain data appears here: a structured clone drops class identity, so a refusal - which is a
 * `TranspileError` on both sides - travels as the location it carries and is rebuilt on arrival.
 */

export interface CompileRequest {
    /** Matches a response to its request; the worker takes them one at a time but replies out of band. */
    id: number;
    /**
     * Discriminates this from a transpile request: one worker bundle serves both, so that ts-morph is
     * carried once rather than once per entry point. The two run on separate instances of it.
     */
    kind: "compile";
    /** The document's text, which may hold edits that were never saved. */
    text: string;
    /** The path that text belongs to. Never read - it resolves imports and names refusals. */
    filepath: string;
    /** Where to write the bytecode, or null to compile and keep nothing. */
    intPath: string | null;
    /** Where to write the readable SSL, or null to not produce it. */
    sslPath: string | null;
    level: 0 | 1 | 2;
    shortCircuit: boolean;
}

/** A refusal, flattened to what `TranspileError` needs to be rebuilt from. */
export interface CompileFailure {
    message: string;
    file?: string;
    line?: number;
    column?: number;
}

export interface CompileResponse {
    id: number;
    /** Absent on success. A compile either produces both requested files or neither. */
    failure?: CompileFailure;
}
