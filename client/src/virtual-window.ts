/**
 * Which slice of a fixed-row-height list is worth mounting.
 *
 * Shared by the webview bundles (binary editor lists and effect tree, dialog outline) rather than owned by
 * one of them: they window the same way, and a second copy would drift. Fixed row height is the contract -
 * a caller whose rows can wrap has no single `rowHeight` to pass and needs a different mechanism.
 */
export interface RangeInput {
    scrollTop: number;
    viewportHeight: number;
    rowHeight: number;
    overscan: number;
    total: number;
}

export function visibleRange(i: RangeInput): { start: number; end: number } {
    const first = Math.floor(i.scrollTop / i.rowHeight);
    const visible = Math.ceil(i.viewportHeight / i.rowHeight);
    const start = Math.max(0, first - i.overscan);
    const end = Math.min(i.total, first + visible + i.overscan);
    return { start, end: Math.max(start, end) };
}
