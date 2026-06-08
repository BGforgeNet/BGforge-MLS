import type { ParsedField, ParsedGroup } from "@bgforge/binary";
import { type FlatNode, type Model, visibleNodes } from "./model";
import type { RelationshipModel } from "./relationship/types";
import type { NodeId, Row } from "./types";

/**
 * Row count for the initial/refresh window the editor sends for a document's root: open, reopen,
 * expand/collapse, undo/redo, and the post-mutation changeset. One shared value so these paths cannot
 * drift apart (the old mix of 200 and 500 risked a changeset truncating a tree with >200 visible rows
 * while expand returned 500). Sized well above the visible-depth-0 row count of every current format
 * (sections + one expanded list); the windowed getChildren path serves anything larger. Forms that
 * render all fields at once (the declarative PRO layout) send their full field set rather than a windowed slice.
 */
export const DEFAULT_WINDOW = 500;

/** Keep only printable-ASCII characters (0x20..0x7E) for display, dropping control/high bytes that render as
 *  mojibake. Used for chars/resref fields whose unused records may hold garbage bytes. Display-only. */
function toPrintableDisplay(s: string): string {
    return s.replaceAll(/[^ -~]/g, "");
}

export function projectRow(
    model: Model,
    node: FlatNode,
    rel?: RelationshipModel,
    composeSummary?: (node: FlatNode, model: Model, rel?: RelationshipModel) => string | undefined,
): Row {
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
        if (composeSummary !== undefined) {
            const s = composeSummary(node, model, rel);
            if (s) base.summary = s;
        }
        return base;
    }
    // kind === "field" guarantees the source is a ParsedField.
    const field = node.source as ParsedField;
    base.valueType = field.type;
    // A `string` (chars/resref) field can hold non-printable bytes in unused records, which render as mojibake
    // glyphs. Show only the printable-ASCII subset. Display-only: the model keeps the raw bytes (field.value),
    // so an untouched field still round-trips byte-identically; an explicit edit normalises it, which is the
    // intent when editing a resource name.
    base.displayValue = field.type === "string" ? toPrintableDisplay(String(field.value)) : String(field.value);
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
    if (field.searchableEnum === true) base.searchableEnum = true;
    if (field.numericFormat !== undefined) base.numericFormat = field.numericFormat;
    // Apply relationship-model overlay last so it can rename/redescribe/re-type a field
    // without touching the underlying ParsedField or the canonical document bytes.
    if (rel !== undefined) {
        const ov = rel.fieldOverride(model, node);
        if (ov !== undefined) {
            if (ov.label !== undefined) base.name = ov.label;
            if (ov.description !== undefined) base.description = ov.description;
            if (ov.enumOptions !== undefined) base.enumOptions = ov.enumOptions;
            if (ov.editable !== undefined) base.editable = ov.editable;
            // `presentationType: "enum"` re-types a numeric field so the view renders the named
            // dropdown - the field's underlying `valueType`/codec is unchanged (display only).
            // This is what makes a discriminator (e.g. an IE effect opcode) reinterpret a sibling
            // parameter as a named value. Only "enum" is mapped: a flags overlay would also need
            // flagOptions, which the IE relationship layer does not produce.
            if (ov.presentationType === "enum") base.valueType = "enum";
        }
    }
    return base;
}

export function getWindow(
    model: Model,
    start: number,
    end: number,
    rel?: RelationshipModel,
    composeSummary?: (node: FlatNode, model: Model, rel?: RelationshipModel) => string | undefined,
): Row[] {
    const visible = visibleNodes(model);
    return visible.slice(start, end).map((node) => projectRow(model, node, rel, composeSummary));
}

export function getChildren(
    model: Model,
    parentId: NodeId | null,
    start: number,
    end: number,
    rel?: RelationshipModel,
    composeSummary?: (node: FlatNode, model: Model, rel?: RelationshipModel) => string | undefined,
): { rows: Row[]; total: number } {
    const indices = model.childrenByParent.get(parentId ?? "") ?? [];
    const rows = indices.slice(start, end).map((i) => projectRow(model, model.nodes[i]!, rel, composeSummary));
    return { rows, total: indices.length };
}
