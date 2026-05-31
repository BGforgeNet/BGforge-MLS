import type { ParsedField, ParsedGroup } from "@bgforge/binary";
import { type FlatNode, type Model, visibleNodes } from "./model";
import type { Row } from "./types";

export function projectRow(model: Model, node: FlatNode): Row {
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
    base.rawValue = field.rawValue;
    base.offset = field.offset;
    base.size = field.size;
    // Fields inside an editingLocked ancestor group are not editable; padding and
    // note fields carry no user-editable data regardless of lock state.
    base.editable = node.parentLocked !== true && field.type !== "padding" && field.type !== "note";
    return base;
}

export function getWindow(model: Model, start: number, end: number): Row[] {
    const visible = visibleNodes(model);
    return visible.slice(start, end).map((node) => projectRow(model, node));
}
