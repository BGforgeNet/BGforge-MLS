/** A byte-range replacement: replace `text[start, end)` with `replacement`. */
export interface SpliceOp {
    start: number;
    end: number;
    /** Replacement text. Empty string removes the span. */
    replacement: string;
}

/**
 * Apply non-overlapping splice ops to `text`. Ops are sorted by start descending and applied
 * right-to-left so earlier offsets stay valid as later spans are substituted. Shared by the D
 * and SSL surgical editors so both have one byte-splice core.
 */
export function applySplices(text: string, ops: readonly SpliceOp[]): string {
    let out = text;
    for (const op of [...ops].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, op.start) + op.replacement + out.slice(op.end);
    }
    return out;
}
