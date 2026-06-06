import { formatAdapterRegistry, toSemanticFieldKey, type FormatLayout } from "@bgforge/binary";
import type { Model } from "./model";
import { projectRow } from "./window";
import type { LayoutDescriptor, ResolvedLayout, Row, SectionDescriptor } from "./types";

/**
 * Resolve a format's declarative layout for the model's active variant: select the variant the parser
 * reported (`parseResult.variantId`, or the first declared variant as a fallback) and build a
 * `FieldRef -> Row` map by projecting every field node and keying it by its semantic field key
 * (`toSemanticFieldKey(format, sourceSegments)`) - the same key the layout schema references. Returns
 * undefined when the selected variant does not exist, so `buildLayout` can fall back to the legacy path.
 *
 * The whole field set is resolved up front (not just referenced keys): the layout formats are small
 * and form-only, so this avoids a per-ref lookup pass and keeps the renderer a pure data consumer.
 */
export function resolveLayout(formatId: string, layout: FormatLayout, model: Model): ResolvedLayout | undefined {
    const variantId = model.parseResult.variantId ?? Object.keys(layout.variants)[0];
    const variant = variantId === undefined ? undefined : layout.variants[variantId];
    if (variantId === undefined || !variant) return undefined;

    const fields: Record<string, Row> = {};
    for (const node of model.nodes) {
        if (node.kind !== "field") continue;
        const key = toSemanticFieldKey(formatId, node.sourceSegments);
        // First write wins: a semantic key is the field's stable identity, and the model lists each
        // field once, so collisions would only arise from a malformed duplicate - keep the first.
        if (key !== undefined && !(key in fields)) fields[key] = projectRow(model, node);
    }
    return { variantId, rows: variant.rows, maxContentWidthPx: layout.maxContentWidthPx, fields };
}

export function buildLayout(formatId: string, model: Model): LayoutDescriptor {
    const adapter = formatAdapterRegistry.get(formatId);

    // Layout-schema formats render via the generic layout renderer; the legacy tabs path is skipped.
    if (adapter?.layout) {
        const layout = resolveLayout(formatId, adapter.layout, model);
        if (layout) return { formatId, sections: [], layout };
    }

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
