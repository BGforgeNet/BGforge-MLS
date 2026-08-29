/**
 * The messages crossing between the server's thread and the transpile worker.
 *
 * Only plain data appears here, for the reason the TSSL compile worker's protocol gives: a structured
 * clone drops class identity, so a refusal - a `TranspileError` on both sides - travels as the
 * location it carries and is rebuilt on arrival.
 *
 * The transpilers' own results are already clone-safe (`{output: string, warnings: TDWarning[],
 * sourceMap: ReadonlyArray<SourcePosition | undefined>}`), so they cross unchanged.
 */

import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import type { SourcePosition } from "../../../transpilers/common/line-map";
import type { TDWarning } from "../../../transpilers/td/src/types";

/**
 * What the worker is being asked for. Every one is pure `(path, text) -> plain data`, which is what
 * makes moving them off the server thread safe; the parse kinds ride along because one importer of
 * ts-morph is enough to keep the whole library in the server bundle.
 */
export type TranspileKind = "td" | "tbaf" | "parse-td" | "parse-tssl";

export interface TranspileRequest {
    /** Matches a response to its request; the worker takes them one at a time but replies out of band. */
    id: number;
    kind: TranspileKind;
    /** The path the text belongs to. Resolves imports and names refusals. */
    filepath: string;
    /** The document's text, which may hold edits that were never saved. */
    text: string;
    /**
     * For `parse-tssl` only: the SSL functions treated as having side effects.
     *
     * Sent rather than resolved worker-side. It is derived from static shipped symbol data, so a worker
     * could in principle compute it - but the loader behind it reports through the LSP connection, which
     * exists only on the server thread. A few hundred short strings clone in well under a millisecond.
     */
    sideEffectFns?: readonly string[];
}

/** A refusal, flattened to what `TranspileError` needs to be rebuilt from. */
export interface TranspileFailure {
    message: string;
    file?: string;
    line?: number;
    column?: number;
}

/** What the transpilers return. TBAF produces no warnings, so the field is empty rather than absent. */
export interface TranspileWorkerResult {
    output: string;
    warnings: TDWarning[];
    sourceMap: ReadonlyArray<SourcePosition | undefined>;
}

export interface TranspileResponse {
    id: number;
    /** Set for the transpile kinds. Exactly one of `result`, `parsed` and `failure` is present. */
    result?: TranspileWorkerResult;
    /** Set for the parse kinds. Already the model the dialog editor receives, so it clones as-is. */
    parsed?: DDialogData | SSLDialogData;
    failure?: TranspileFailure;
}
