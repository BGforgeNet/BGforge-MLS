import type { ParsedField, ParsedGroup } from "@bgforge/binary";
import { type FlatNode, type Model, visibleNodes } from "./model";
import type { RelationshipModel } from "./relationship/types";
import type { NodeId, Row } from "./types";

export function projectRow(model: Model, node: FlatNode, rel?: RelationshipModel): Row {
    const base: Row = {
        id: node.id,
        namePath: node.namePath,
        depth: node.depth,
        kind: node.kind,
        name: node.name,
    };
    if (node.kind === "group") {
        const group = node.source as ParsedGroup;
        base.expanded = model.expanded.has(node.id);
        base.hasChildren = node.childCount > 0;
        base.editingLocked = group.editingLocked === true;
        return base;
    }
    // kind === "field" guarantees the source is a ParsedField.
    const field = node.source as ParsedField;
    base.valueType = field.type;
    base.displayValue = String(field.value);
    // `rawValue` is the underlying editable value. The parser only sets `field.rawValue` when it
    // differs from `field.value` (enums/flags carry the numeric code); plain numbers leave it unset,
    // so fall back to `field.value` - otherwise numeric controls render with no value.
    const rawCandidate = field.rawValue ?? field.value;
    if (typeof rawCandidate === "number" || typeof rawCandidate === "string") base.rawValue = rawCandidate;
    base.offset = field.offset;
    base.size = field.size;
    // Fields inside an editingLocked ancestor group are not editable; padding and
    // note fields carry no user-editable data regardless of lock state.
    base.editable = node.parentLocked !== true && field.type !== "padding" && field.type !== "note";
    if (field.description !== undefined) base.description = field.description;
    if (field.enumOptions !== undefined) base.enumOptions = field.enumOptions;
    if (field.flagOptions !== undefined) base.flagOptions = field.flagOptions;
    // Apply relationship-model overlay last so it can rename/redescribe/re-type a field
    // without touching the underlying ParsedField or the canonical document bytes.
    if (rel !== undefined) {
        const ov = rel.fieldOverride(model, node);
        if (ov !== undefined) {
            if (ov.label !== undefined) base.name = ov.label;
            if (ov.description !== undefined) base.description = ov.description;
            if (ov.enumOptions !== undefined) base.enumOptions = ov.enumOptions;
            if (ov.editable !== undefined) base.editable = ov.editable;
        }
    }
    return base;
}

export function getWindow(model: Model, start: number, end: number, rel?: RelationshipModel): Row[] {
    const visible = visibleNodes(model);
    return visible.slice(start, end).map((node) => projectRow(model, node, rel));
}

export function getChildren(
    model: Model,
    parentId: NodeId | null,
    start: number,
    end: number,
    rel?: RelationshipModel,
): { rows: Row[]; total: number } {
    const indices = model.childrenByParent.get(parentId ?? "") ?? [];
    const rows = indices.slice(start, end).map((i) => projectRow(model, model.nodes[i]!, rel));
    return { rows, total: indices.length };
}
