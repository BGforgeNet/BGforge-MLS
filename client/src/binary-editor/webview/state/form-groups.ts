import type { Row } from "@bgforge/binary-editor";

/** Separate a form's ungrouped fields (rendered above any tab strip) from its groups, preserving order. */
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

export type GroupOrganization = { mode: "tabs"; orientation: "horizontal" | "vertical" } | { mode: "sections" };

/**
 * Decide how a level of groups renders. depth is the group nesting level inside the detail form (1 = first level,
 * sitting under the horizontal section tabs). Orientation alternates with depth so adjacent tab levels never blur:
 * odd depth -> vertical, even depth -> horizontal. 0-1 groups or > threshold groups -> stacked headed sections.
 */
export function organizeGroups(groups: Row[], depth: number, threshold = 6): GroupOrganization {
    if (groups.length < 2 || groups.length > threshold) {
        return { mode: "sections" };
    }
    return { mode: "tabs", orientation: depth % 2 === 1 ? "vertical" : "horizontal" };
}
