import type { ExternalRef, FieldRef, FlagsRef, LayoutRow, ParsedFieldType } from "@bgforge/binary";

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
    /** Display hint (from a `view: "slots"` group): render this group's scalar fields in N columns. */
    columns?: number;
    /** Composed human label for a list entry, e.g. an effect's opcode name; set by the per-format summary composer. */
    summary?: string;
    /** Display hint (from the spec's `hidden` flag): omit this row from the rendered detail form. The node
     *  stays in the tree so the byte round-trip is unaffected; only the view skips it. Set for reserved/
     *  padding/magic fields (`unused*`, `unknown`, duplicated signature/version). */
    hidden?: boolean;
    // field-only
    valueType?: ParsedFieldType;
    displayValue?: string;
    rawValue?: number | string;
    offset?: number;
    size?: number;
    editable?: boolean;
    description?: string;
    /** Link to the field's full online documentation, shown as a small external-link affordance beside the
     *  label when its `description` tooltip was capped for length (from the presentation schema's `docUrl`). */
    docUrl?: string;
    enumOptions?: Readonly<Record<string, string>>;
    flagOptions?: Readonly<Record<string, string>>;
    /** What this bitfield's BITS refer to outside the file (from the spec's `flagsRef`) - the bit-level sibling
     *  of `ref`, which resolves the row's VALUE. A bitfield can carry both. */
    flagsRef?: FlagsRef;
    /** Per-bit names the OPEN GAME gives this bitfield's bits, keyed by the bit as a decimal string, resolved
     *  by the host from `flagsRef`. Many names per bit is normal and is why this is a list: several Enhanced
     *  Edition kits share one ITM kit-usability bit. Absent outside a game, and absent for a bit the install
     *  says nothing about - the vendored flag label stands in both cases. */
    flagBitNames?: Readonly<Record<string, readonly string[]>>;
    /** Display hint (from the spec's `enumOpen`): the enum is advisory, so the dropdown accepts a custom
     *  numeric value (shown as "N Unknown"). Closed enums omit this and reject off-list values at save. */
    enumOpen?: boolean;
    /** The row's VALUE points outside the file (from the spec's `ref`) - a `dialog.tlk` line, an IDS entry. The
     *  row stays editable as its own type; this only marks it resolvable by a consumer holding the game. */
    ref?: ExternalRef;
    /** This row is one slot of an array whose slots an external source NAMES - a CRE sound slot, named by an IDS
     *  table the game ships. Distinct from `ref`, which resolves the value; a slot commonly carries both. The
     *  host swaps the generic label for the game's own identifier; absent outside a game. */
    slotRef?: { ref: ExternalRef; index: number };
    /** The line a `strref` ref points at, resolved against the game the record was opened from. Filled by the
     *  host, which owns the game session - never by the parser, which has no game context. Absent when the
     *  record is not from an installed game, the value is the -1 sentinel, or the TLK has no such entry. */
    strrefText?: string;
    /** A resref whose target the OPEN GAME actually has, resolved by the host to the candidate type that
     *  exists. Absent outside a game and for a resref nothing resolves - the view offers to open it only when
     *  this is set, and never marks its absence (a mod record may point at what a later install step creates). */
    openTarget?: { resref: string; ext: string };
    /** The resolved target is a picture (an icon BAM, a portrait BMP), so the view shows it inline. Carried as
     *  its own row property, and set at the same moment as `openTarget`, so the fixed-size slot exists from the
     *  first paint - a thumbnail that appeared once its bytes arrived would reflow the field grid. The bytes
     *  themselves are fetched lazily by the view, keyed on this. */
    thumbnail?: { resref: string; ext: string };
    /** The extension a `resource` ref points at IN THIS GAME (the declared type, or this flavour's override),
     *  set whenever the record was opened from a game - unlike `openTarget`, which additionally requires the
     *  current value to resolve. It is what makes the field pickable: the view offers the game's resources of
     *  this type as suggestions. Absent outside a game and for a `deferred` ref, whose type no field declares. */
    refExt?: string;
    /** Numeric display format: `hex32` renders/edits as `0x...`. `rawValue` stays the stored number.
     *  (Signedness is the field codec's job, not a display format.) */
    numericFormat?: "hex32";
    /** Effective advisory bounds for a field still presented as a raw number: the storage-type range
     *  (`getNumericTypeRange`) narrowed by a `domain:` declaration when one exists (`getDomainRange`) - see
     *  `binary-format-contract.ts`. Undefined for a field presented as an enum/flags dropdown (native or
     *  overlay-retyped) or a non-numeric field (string/padding/note); those have no `NumericTypeName` match. */
    min?: number;
    max?: number;
    /** Semantic field key (`toSemanticFieldKey(format, sourceSegments)`) for field rows, e.g.
     *  `cre.effects[].v2.opcode`. Lets a list entry's detail pane build a per-entry `FieldRef -> Row` map and
     *  render through a shared layout fragment; undefined for groups and fields whose key does not resolve. */
    semanticKey?: string;
    /** Cross-record jump target (from the relationship overlay): the field's value references another record,
     *  and `targetNodeId` is that record's entry node. `sectionKey` is the target's list section, so the view
     *  can switch to the tab/subtab holding it; the view renders a clickable affordance showing `label` that
     *  navigates to it (e.g. a MAP script's Owner ID -> its object; an object's SID -> its script). */
    link?: { targetNodeId: NodeId; sectionKey: string; label: string };
}

export interface Diagnostic {
    nodeId: NodeId;
    severity: "warning" | "error" | "info";
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
    /** Refreshed tab count badges (tab id -> count) after a structure op that changed an entry count, so the
     *  webview can update the live tab labels (e.g. the Spells tab's known/memorized). Absent for field edits. */
    tabCounts?: Record<string, number | string>;
}

export interface EditResult {
    changeSet: ChangeSet;
}

export interface StructureResult {
    changeSet: ChangeSet;
    selection?: NodeId;
}

/** A list section a layout `list` block targets: the model node to render, its structure-op caps, and its
 *  current entry count (for tab count badges). */
export interface LayoutSection {
    nodeId: NodeId;
    canAdd: boolean;
    canModify: boolean;
    entryCount: number;
    /** When set, each entry's detail offers an owner-scoped "add a `childAddSection` entry to this entry" action. */
    childAddSection?: string;
}

/** A tab resolved for rendering: its label, an optional count badge (resolved from a `countFrom` section's
 *  entry count, omitted when the section is absent), and a body that is EITHER rows or one level of subtabs. */
export interface ResolvedTab {
    id: string;
    label: string;
    icon?: string;
    count?: number | string; // a single entry count, or an "x/y" pair (e.g. the Spells tab's known/memorized)
    rows?: LayoutRow[];
    tabs?: ResolvedTab[];
    /** Greyed out and non-selectable - evaluated from the subtab's `disabledWhen` flag predicate (e.g. a MAP
     *  elevation absent per the header skip-flag). */
    disabled?: boolean;
}

/**
 * A format's layout resolved for the active variant: the layout-schema structure (rows when untabbed, or
 * tabs when the variant declares them), a map from every field's semantic key (`FieldRef`) to its renderable
 * `Row`, and a map of the `list`-block sections (keyed by group name). The whole field set is resolved up
 * front (the formats are small/form-heavy); variable-length list sections use the windowed getChildren path.
 */
export interface ResolvedLayout {
    variantId: string;
    /** Present when the variant is untabbed. Mutually exclusive with `tabs`. */
    rows?: LayoutRow[];
    /** Present when the variant declares top-level tabs. Mutually exclusive with `rows`. */
    tabs?: ResolvedTab[];
    maxContentWidthPx?: number;
    fields: Record<FieldRef, Row>;
    /** `list`-block sections (keyed by group name) with their model node id, structure-op caps, entry count. */
    sections: Record<string, LayoutSection>;
    /** Raw display-label overrides (the schema's `labels`), passed through so a master-detail `detailVariant`
     *  can apply them when building its per-entry field map (the global `fields` map only holds one entry). */
    labels?: Record<FieldRef, string>;
}

export interface LayoutDescriptor {
    formatId: string;
    /** Present for any successfully parsed file (every format ships a layout); absent for error results. */
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
