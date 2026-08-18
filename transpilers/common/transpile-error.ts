/**
 * Structured error type for transpiler failures, carrying source location.
 * Replaces bare Error throws across TSSL, TBAF, and TD transpilers so callers
 * can surface file:line information in diagnostics and CLI output.
 */

import type { SourcePosition } from "./line-map";

interface TranspileErrorLocation {
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
}

export class TranspileError extends Error {
    readonly location: TranspileErrorLocation;

    constructor(message: string, location: TranspileErrorLocation = {}, cause?: unknown) {
        super(message);
        this.name = "TranspileError";
        this.location = location;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }

    /** Build a TranspileError from a ts-morph Node, reading line from it. */
    static fromNode(node: { getStartLineNumber(): number }, message: string, filePath?: string): TranspileError {
        return new TranspileError(message, { file: filePath, line: node.getStartLineNumber() });
    }

    /** Wrap an unknown thrown value as a TranspileError, filling in missing location fields. */
    static wrap(err: unknown, location: TranspileErrorLocation): TranspileError {
        if (err instanceof TranspileError) {
            // Fill in only fields that are missing from the inner error
            const merged: TranspileErrorLocation = {
                file: err.location.file ?? location.file,
                line: err.location.line ?? location.line,
                column: err.location.column ?? location.column,
            };
            return new TranspileError(err.message, merged, err);
        }
        const message = err instanceof Error ? err.message : String(err);
        return new TranspileError(message, location, err);
    }

    /**
     * Restate a failure found after bundling against the file the author wrote.
     *
     * Everything downstream of the bundler reads one concatenated text, so the line an error carries is a
     * line of that text - against the source it would name whatever happens to sit there. A line the map
     * cannot account for is dropped rather than kept, since a wrong line costs more than none: it sends the
     * reader to code that has nothing to do with the failure. The column goes with it, being an offset into
     * a line of the bundle that no longer applies once the file changes.
     */
    static remap(err: unknown, origins: ReadonlyArray<SourcePosition | undefined>): unknown {
        if (!(err instanceof TranspileError) || err.location.line === undefined) return err;
        const origin = origins[err.location.line - 1];
        if (origin === undefined) {
            return new TranspileError(err.message, { file: err.location.file }, err);
        }
        return new TranspileError(err.message, { file: origin.file, line: origin.line + 1 }, err);
    }
}
