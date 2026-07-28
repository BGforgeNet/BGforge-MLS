import {
    type ParsedField,
    type ParsedGroup,
    getDomainRange,
    getNumericTypeRange,
    resolveFieldPresentation,
    toSemanticFieldKey,
} from "@bgforge/binary";
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
        if (group.hidden === true) base.hidden = true;
        if (group.columns !== undefined) base.columns = group.columns;
        if (composeSummary !== undefined) {
            const s = composeSummary(node, model, rel);
            if (s) base.summary = s;
        }
        return base;
    }
    // kind === "field" guarantees the source is a ParsedField.
    const field = node.source as ParsedField;
    base.valueType = field.type;
    // Show the field's value verbatim - including non-printable / high bytes that render as mojibake in unused
    // records. Faithful display is preferred over prettifying; the model keeps the raw bytes either way, so an
    // untouched field round-trips byte-identically.
    base.displayValue = String(field.value);
    // `rawValue` is the underlying editable value. The parser only sets `field.rawValue` when it
    // differs from `field.value` (enums/flags carry the numeric code); plain numbers leave it unset,
    // so fall back to `field.value` - otherwise numeric controls render with no value.
    const rawCandidate = field.rawValue ?? field.value;
    if (typeof rawCandidate === "number" || typeof rawCandidate === "string") base.rawValue = rawCandidate;
    base.offset = field.offset;
    base.size = field.size;
    if (field.hidden === true) base.hidden = true;
    // Fields inside an editingLocked ancestor group are not editable; padding and
    // note fields carry no user-editable data regardless of lock state.
    base.editable = node.parentLocked !== true && field.type !== "padding" && field.type !== "note";
    // A field inside an editing-locked (partially-undecoded) subtree is read-only for THAT reason
    // specifically - distinct from padding/note fields, which are non-editable for their own reason. Carry
    // the flag so the view can explain WHY the control is disabled (mirrors the group row's editingLocked).
    if (node.parentLocked === true) base.editingLocked = true;
    if (field.description !== undefined) base.description = field.description;
    if (field.enumOptions !== undefined) base.enumOptions = field.enumOptions;
    if (field.flagOptions !== undefined) base.flagOptions = field.flagOptions;
    if (field.enumOpen === true) base.enumOpen = true;
    if (field.strref === true) base.strref = true;
    if (field.idsSlot !== undefined) base.idsSlot = field.idsSlot;
    if (field.numericFormat !== undefined) base.numericFormat = field.numericFormat;
    // Semantic key (stable, index-collapsed) lets a list entry's detail pane key its child rows for a shared
    // layout fragment. Computed for fields only; undefined when the format/segments don't resolve to a key.
    const semanticKey = toSemanticFieldKey(model.parseResult.format, node.sourceSegments);
    if (semanticKey !== undefined) base.semanticKey = semanticKey;
    // Static per-field tooltip from the format's presentation schema (cleaned IESDP desc). Editor-only: it
    // rides the presentation layer, not the parsed document, so the JSON snapshot is unaffected. Layered over
    // any parser-set description (above) and under the relationship overlay's dynamic redescribe (below).
    if (semanticKey !== undefined) {
        const pres = resolveFieldPresentation(model.parseResult.format, semanticKey, node.name);
        if (pres?.description !== undefined) base.description = pres.description;
        if (pres?.docUrl !== undefined) base.docUrl = pres.docUrl;
    }
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
            // A cross-record reference field (e.g. MAP script Owner ID -> object) carries its jump target.
            if (ov.link !== undefined) base.link = ov.link;
        }
    }
    // Effective advisory range (storage-type bounds narrowed by any domain declaration) for a field still
    // presented as a raw number. Keyed off `base.valueType` AFTER the overlay above: `getNumericTypeRange`
    // only matches the 8 NumericTypeName literals, so it naturally excludes an enum/flags-typed field and
    // one the overlay retyped to "enum" for display - min/max would be meaningless once the control is a
    // dropdown. Consumed by the webview for the input's min/max attributes and its live out-of-range hint;
    // the write-time zod gate (derive-zod.ts) stays the sole save-blocking authority.
    const typeRange = getNumericTypeRange(base.valueType ?? "");
    if (typeRange) {
        let min = typeRange.min;
        let max = typeRange.max;
        const domainRange =
            semanticKey !== undefined ? getDomainRange(model.parseResult.format, semanticKey) : undefined;
        if (domainRange) {
            min = domainRange.min;
            max = domainRange.max;
        }
        base.min = min;
        base.max = max;
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
