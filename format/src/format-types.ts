/**
 * Shared types and helpers for the tree-based formatters (Fallout SSL, WeiDU
 * BAF/D/TP2). Package-internal: imported relatively, not re-exported from the
 * public index. `FormatContext` is intentionally NOT shared here - each
 * formatter's context carries a different field set.
 */

/** Result of a tree-based formatter. */
export interface FormatResult {
    text: string;
}

/**
 * Formatting options shared by Fallout SSL and WeiDU D/TP2.
 * WeiDU BAF deliberately omits `lineLimit` (its format is line-based with no
 * wrapping), so it declares its own narrower options type.
 */
export interface FormatOptions {
    indentSize: number;
    lineLimit: number;
}

export const DEFAULT_OPTIONS: FormatOptions = {
    indentSize: 4,
    lineLimit: 120,
};

/** Abort formatting with a descriptive error including source location. */
export function throwFormatError(message: string, line: number, column: number): never {
    throw new Error(`${line}:${column}: ${message}`);
}
