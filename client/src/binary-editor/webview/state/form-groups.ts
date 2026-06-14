import type { Row } from "@bgforge/binary-editor";

/** Separate a form's ungrouped fields (rendered above the group sections) from its groups, preserving order. */
export function splitForm(rows: Row[]): { fields: Row[]; groups: Row[] } {
    const fields: Row[] = [];
    const groups: Row[] = [];
    for (const row of rows) {
        if (row.kind === "group") {
            groups.push(row);
        } else {
            fields.push(row);
        }
    }
    return { fields, groups };
}
