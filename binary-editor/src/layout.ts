import { formatAdapterRegistry } from "@bgforge/binary";
import type { Model } from "./model";
import type { LayoutDescriptor, SectionDescriptor } from "./types";

/** Format ids whose named depth-0 groups should render as master-detail lists.
 *  Everything else renders as a form. MAP's variable collections are lists. */
const LIST_SECTION_NAMES: Record<string, ReadonlySet<string>> = {
    map: new Set(["Global Variables", "Local Variables", "Scripts", "Objects"]),
};

export function buildLayout(formatId: string, model: Model): LayoutDescriptor {
    const adapter = formatAdapterRegistry.get(formatId);
    const listNames = LIST_SECTION_NAMES[formatId] ?? new Set<string>();
    const sections: SectionDescriptor[] = model.nodes
        .filter((n) => n.depth === 0 && n.kind === "group")
        .map((n) => {
            const isList = listNames.has(n.name);
            const childIndices = model.childrenByParent.get(n.id) ?? [];
            const firstChild = childIndices.length > 0 ? model.nodes[childIndices[0]!] : undefined;
            const canAdd = adapter?.isAddableArray?.([n.name]) ?? false;
            // Use a plausible entry path to probe removability; if the section has a child, use its name, otherwise fall
            // back to the empty-array case which the adapter will decline. The predicate is shape-based, not count-based,
            // so any valid entry name from the same array is representative.
            const entryName = firstChild?.name;
            const canModify =
                entryName !== undefined ? (adapter?.isRemovableEntry?.([n.name, entryName]) ?? false) : false;
            // Derive the render hint structurally: a list section whose entries are plain fields (e.g. MAP int32
            // variables) displays inline (one field per row); anything else uses master-detail.
            const render: "inline" | "master-detail" =
                isList && firstChild?.kind === "field" ? "inline" : "master-detail";
            return { id: n.id, title: n.name, kind: isList ? "list" : "form", nodeId: n.id, render, canAdd, canModify };
        });
    return { formatId, sections };
}
