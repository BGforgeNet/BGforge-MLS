import type { FieldRef, LayoutRow, ParsedFieldType } from "@bgforge/binary";

export type SessionId = string;

/** Stable, index-derived id for a node in the flattened tree (e.g. "0/3/1"). */
export type NodeId = string;

/** Tree-segment NAME path from root, used for display and for library adapter calls
 *  (e.g. ["Global Variables", "Global Var 0"]). Names are not guaranteed unique
 *  across siblings, so NodeId - not the name path - is the identity key. */
export type NamePath = readonly string[];

export interface Row {
    id: NodeId;
    namePath: NamePath;
    depth: number;
    kind: "group" | "field";
    name: string;
    // group-only
    expanded?: boolean;
    hasChildren?: boolean;
    editingLocked?: boolean;
    /** Composed human label for a list entry, e.g. an effect's opcode name; set by the per-format summary composer. */
    summary?: string;
    // field-only
    valueType?: ParsedFieldType;
    displayValue?: string;
    rawValue?: number | string;
    offset?: number;
    size?: number;
    editable?: boolean;
    description?: string;
    enumOptions?: Readonly<Record<string, string>>;
    flagOptions?: Readonly<Record<string, string>>;
}

export interface Diagnostic {
    nodeId: NodeId;
    severity: "warning" | "error";
    message: string;
    quickFix?: { label: string; edits: { nodeId: NodeId; value: number | string }[] };
}

/** Returned by every mutation. `changed` lists rows whose value OR shape changed
 *  and must be re-rendered. */
export interface ChangeSet {
    changed: Row[];
    diagnostics: Diagnostic[];
    dirty: boolean;
    formatValid: boolean;
}

export interface EditResult {
    changeSet: ChangeSet;
}

export interface StructureResult {
    changeSet: ChangeSet;
    selection?: NodeId;
}

export interface SectionDescriptor {
    id: string;
    title: string;
    kind: "form" | "list";
    /** NodeId of the top-level group this section renders. */
    nodeId: NodeId;
    /** "inline": single-field entries edited in the row (MAP variables). "master-detail": multi-field entries. */
    render: "inline" | "master-detail";
    /** Adapter says this collection accepts appended entries. */
    canAdd: boolean;
    /** Adapter says entries can be removed/inserted/reordered/duplicated. */
    canModify: boolean;
}

/**
 * A format's layout resolved for the active variant: the layout-schema rows verbatim plus a map from
 * every field's semantic key (`FieldRef`) to its renderable `Row`. PRO is form-only and small (~90
 * fields), so the editor sends all field rows up front; list blocks (when other formats migrate) keep
 * using the windowed getChildren path keyed by `sectionKey`.
 */
export interface ResolvedLayout {
    variantId: string;
    rows: LayoutRow[];
    maxContentWidthPx?: number;
    fields: Record<FieldRef, Row>;
}

export interface LayoutDescriptor {
    formatId: string;
    /** Legacy depth-0-groups-as-tabs path. Empty/unused when `layout` is present. */
    sections: SectionDescriptor[];
    /** Present only for formats whose adapter declares a declarative `layout` schema. */
    layout?: ResolvedLayout;
}

export interface OpenResult {
    sessionId: SessionId;
    format: string;
    formatName: string;
    layout: LayoutDescriptor;
    warnings: string[];
    errors: string[];
    /** First window of the root (top-level rows). */
    rootWindow: Row[];
}
