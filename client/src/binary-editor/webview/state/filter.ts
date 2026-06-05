import type { Row } from "@bgforge/binary-editor";

/** Case-insensitive substring filter over a row's displayed text (summary + positional name).
 * Empty or whitespace-only query returns all rows unchanged (same array reference). Non-empty
 * queries match against the concatenated summary and name, preserving original order. */
export function filterRows(rows: Row[], query: string): Row[] {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => ((r.summary ?? "") + " " + r.name).toLowerCase().includes(q));
}
