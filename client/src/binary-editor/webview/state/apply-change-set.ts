import type { ChangeSet, OpenResult, ResolvedTab } from "@bgforge/binary-editor";

/**
 * The OpenResult a changeSet leaves behind, built by copying only the path to what changed: each changed row
 * replaces the field it matches by node id, and each tab named in `tabCounts` gets its new count. Everything
 * else keeps its identity, so the view held in `$state.raw` re-renders the changed fields and badges alone.
 * Returns `open` itself when nothing in it changed.
 */
export function applyChangeSet(open: OpenResult, changeSet: ChangeSet): OpenResult {
    const layout = open.layout.layout;
    if (!layout) return open;

    const refById = new Map(Object.entries(layout.fields).map(([ref, row]) => [row.id, ref]));
    const replaced = changeSet.changed.flatMap((row) => {
        const ref = refById.get(row.id);
        return ref === undefined ? [] : [[ref, row] as const];
    });
    // A row named twice lands once; the later copy wins, as it did when rows were patched in order.
    const fields = replaced.length === 0 ? layout.fields : { ...layout.fields, ...Object.fromEntries(replaced) };

    const counts = changeSet.tabCounts;
    const recount = (tabs: ResolvedTab[]): ResolvedTab[] => {
        let out = tabs;
        tabs.forEach((tab, i) => {
            const sub = tab.tabs ? recount(tab.tabs) : undefined;
            const countChanged = counts !== undefined && tab.id in counts && counts[tab.id] !== tab.count;
            if (!countChanged && sub === tab.tabs) return;
            if (out === tabs) out = [...tabs];
            out[i] = { ...tab, ...(countChanged ? { count: counts[tab.id] } : {}), ...(sub ? { tabs: sub } : {}) };
        });
        return out;
    };
    const tabs = layout.tabs && counts ? recount(layout.tabs) : layout.tabs;

    if (fields === layout.fields && tabs === layout.tabs) return open;
    return { ...open, layout: { ...open.layout, layout: { ...layout, fields, ...(tabs ? { tabs } : {}) } } };
}
