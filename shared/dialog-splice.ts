/**
 * Result of verifying a save round-tripped: shared by the D and SSL editors so neither
 * has to depend on the other's module for this format-neutral type.
 */
export interface VerifyResult {
    ok: boolean;
    /** Human-readable reason when `ok` is false (names the first diverging state). */
    reason?: string;
}

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
 *
 * Throws on a malformed (`start > end`) or overlapping op rather than silently corrupting the
 * output: the right-to-left application is only correct when no op's range reaches into a span
 * already substituted, and an overlap is the highest-impact silent-corruption class for the
 * editors built on this. Callers construct disjoint spans; the guard turns any regression that
 * breaks that invariant into a loud failure at the boundary.
 */
export function applySplices(text: string, ops: readonly SpliceOp[]): string {
    // Descending by start: each op is applied before the ops at lower offsets, so a lower-start
    // op's END must not exceed this op's START, or their spans overlap.
    const sorted = [...ops].sort((a, b) => b.start - a.start);
    for (let i = 0; i < sorted.length; i++) {
        const op = sorted[i]!;
        if (op.start > op.end) {
            throw new Error(`applySplices: malformed op start=${op.start} > end=${op.end}`);
        }
        const lower = sorted[i + 1];
        if (lower && lower.end > op.start) {
            throw new Error(`applySplices: overlapping ops [${lower.start},${lower.end}) and [${op.start},${op.end})`);
        }
    }
    let out = text;
    for (const op of sorted) {
        out = out.slice(0, op.start) + op.replacement + out.slice(op.end);
    }
    return out;
}
