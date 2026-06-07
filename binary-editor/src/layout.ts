import {
    type FormatLayout,
    type LayoutSubTab,
    type LayoutTab,
    formatAdapterRegistry,
    toSemanticFieldKey,
    variantRows,
} from "@bgforge/binary";
import type { Model } from "./model";
import { projectRow } from "./window";
import type { LayoutDescriptor, LayoutSection, ResolvedLayout, ResolvedTab, Row } from "./types";

/**
 * Resolve a format's declarative layout for the model's active variant: select the variant the parser
 * reported (`parseResult.variantId`) and build a `FieldRef -> Row` map by projecting every field node
 * and keying it by its semantic field key (`toSemanticFieldKey(format, sourceSegments)`) - the same key
 * the layout schema references. Returns undefined when the parse result reports no variantId or the
 * reported variant is not in the schema (e.g. an error result with no model), so `buildLayout` returns a
 * layout-less descriptor. No first-variant fallback: an un-stamped or unrecognised file must never be
 * forced into an arbitrary variant's layout.
 *
 * The whole field set is resolved up front (not just referenced keys): the layout formats are small
 * and form-only, so this avoids a per-ref lookup pass and keeps the renderer a pure data consumer.
 */
export function resolveLayout(formatId: string, layout: FormatLayout, model: Model): ResolvedLayout | undefined {
    const variantId = model.parseResult.variantId;
    const variant = variantId === undefined ? undefined : layout.variants[variantId];
    if (variantId === undefined || !variant) return undefined;

    const fields: Record<string, Row> = {};
    for (const node of model.nodes) {
        if (node.kind !== "field") continue;
        const key = toSemanticFieldKey(formatId, node.sourceSegments);
        // First write wins: a semantic key is the field's stable identity, and the model lists each
        // field once, so collisions would only arise from a malformed duplicate - keep the first.
        if (key !== undefined && !(key in fields)) {
            const row = projectRow(model, node);
            // Display-label override (layout.labels) is applied here, AFTER identity is computed from the
            // stable parse name - so renaming for display never changes the semantic key a ref resolves by.
            const labelOverride = layout.labels?.[key];
            if (labelOverride !== undefined) row.name = labelOverride;
            // Read-only fields (variant discriminators) stay visible but non-editable - the controls render
            // disabled off row.editable, which is the reliable lock (presentation `editable` doesn't reach here).
            if (layout.readOnlyFields?.includes(key)) row.editable = false;
            fields[key] = row;
        }
    }

    // Sections a `list` block targets, keyed by the depth-0 group name the block names (`sectionKey`).
    // The node id is resolved from the model; the structure-op caps (canAdd/canModify) are declared on the
    // block itself - presentation data in the layout schema, no longer derived from adapter predicates. A
    // block whose section is absent from this file (e.g. a MAP elevation that does not exist) is simply not
    // added, and the renderer prunes its panel.
    const depth0Groups = new Map<string, { id: string; entryCount: number }>();
    for (const node of model.nodes) {
        if (node.depth === 0 && node.kind === "group")
            depth0Groups.set(node.name, { id: node.id, entryCount: node.childCount });
    }
    const sections: Record<string, LayoutSection> = {};
    for (const row of variantRows(variant)) {
        for (const panel of row.panels) {
            for (const block of panel.blocks) {
                if (block.kind !== "list") continue;
                const group = depth0Groups.get(block.sectionKey);
                if (group !== undefined) {
                    sections[block.sectionKey] = {
                        nodeId: group.id,
                        canAdd: block.canAdd,
                        canModify: block.canModify,
                        entryCount: group.entryCount,
                    };
                }
            }
        }
    }

    // Resolve the tab structure for the renderer (count badges come from each `countFrom` section's entry
    // count; omitted when that section is absent from this file). Subtabs nest one level.
    const resolveTab = (t: LayoutTab | LayoutSubTab): ResolvedTab => ({
        id: t.id,
        label: t.label,
        ...(t.icon !== undefined && { icon: t.icon }),
        ...(t.countFrom !== undefined &&
            sections[t.countFrom] !== undefined && { count: sections[t.countFrom]!.entryCount }),
        ...(t.rows !== undefined && { rows: t.rows }),
        ...("tabs" in t && t.tabs !== undefined && { tabs: t.tabs.map((st) => resolveTab(st)) }),
    });

    return {
        variantId,
        ...(variant.rows !== undefined && { rows: variant.rows }),
        ...(variant.tabs !== undefined && { tabs: variant.tabs.map((t) => resolveTab(t)) }),
        maxContentWidthPx: layout.maxContentWidthPx,
        fields,
        sections,
    };
}

/**
 * Build the editor layout for an open file. Every format ships a declarative layout, so a successfully
 * parsed file always resolves one; an error result (no model variant) yields a layout-less descriptor and
 * the webview shows the error banner instead. The legacy depth-0-groups-as-tabs path has been retired.
 */
export function buildLayout(formatId: string, model: Model): LayoutDescriptor {
    const adapter = formatAdapterRegistry.get(formatId);
    const layout = adapter?.layout ? resolveLayout(formatId, adapter.layout, model) : undefined;
    return { formatId, layout };
}
