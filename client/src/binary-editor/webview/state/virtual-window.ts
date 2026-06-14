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
