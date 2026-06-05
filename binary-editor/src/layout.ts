import { formatAdapterRegistry } from "@bgforge/binary";
import type { Model } from "./model";
import type { LayoutDescriptor, SectionDescriptor } from "./types";

export function buildLayout(formatId: string, model: Model): LayoutDescriptor {
    const adapter = formatAdapterRegistry.get(formatId);
    const sections: SectionDescriptor[] = model.nodes
        .filter((n) => n.depth === 0 && n.kind === "group")
        .map((n) => {
            const isList = adapter?.isListSection?.([n.name]) ?? false;
            const childIndices = model.childrenByParent.get(n.id) ?? [];
            const firstChild = childIndices.length > 0 ? model.nodes[childIndices[0]!] : undefined;
            const canAdd = adapter?.isAddableArray?.([n.name]) ?? false;
            // Shape-based, count-independent (fixes F1: an empty list section keeps its modify affordances).
            const canModify = adapter?.isModifiableArray?.([n.name]) ?? false;
            // A list section whose entries are plain fields (MAP int32 vars) renders inline (one field per row);
            // anything else - non-list sections, or sections whose first entry is not a plain field - uses
            // master-detail.
            const render: "inline" | "master-detail" =
                isList && firstChild?.kind === "field" ? "inline" : "master-detail";
            return { id: n.id, title: n.name, kind: isList ? "list" : "form", nodeId: n.id, render, canAdd, canModify };
        });
    return { formatId, sections };
}
