import type { NodeId, Row } from "@bgforge/binary-editor";

/** One windowed slice of a list section's entries, plus the section's full entry count. */
export interface ListWindow {
    rows: Row[];
    total: number;
}

/** Fetch a [start, end) slice of a list section (e.g. `bridge.requestChildren(nodeId, start, end)`). */
export type WindowFetch = (start: number, end: number) => Promise<ListWindow>;

/**
 * Resolve a target entry's row and ABSOLUTE index within a (possibly virtualized) list section.
 *
 * Tries the already-fetched bounded window first. If the id is not there and the list is longer than the
 * window, it fetches the full list so a deep target resolves - a cross-record jump to, say, object #3000 of a
 * 4000-object MAP elevation must land on that object, not silently fall back to the first entry. Returns index
 * -1 when the id is genuinely absent (so callers can clear or fall back deliberately).
 */
export async function locateEntry(
    fetchWindow: WindowFetch,
    windowRows: Row[],
    total: number,
    id: NodeId,
): Promise<{ rows: Row[]; index: number }> {
    const index = windowRows.findIndex((r) => r.id === id);
    if (index !== -1 || total <= windowRows.length) return { rows: windowRows, index };
    const full = await fetchWindow(0, total);
    return { rows: full.rows, index: full.rows.findIndex((r) => r.id === id) };
}
