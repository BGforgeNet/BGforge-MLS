/**
 * Type definitions + zod validator for the per-format declarative LAYOUT schema.
 *
 * This is the presentation layer that lets a format describe its editor UI as data: which fields
 * group into which panels, in what arrangement (key/value list, flag columns, a Base|Bonus matrix,
 * a multi-column grid), independent of the parser's byte order or display-tree grouping. It is the
 * sibling of `presentation-schema-types.ts` (labels/enums/flags per field) - together they make a
 * format's whole editor presentation declarative data attached to the `BinaryFormatAdapter`, with
 * the parser/codec staying a faithful bytes<->model mapping.
 *
 * A field is referenced by its SEMANTIC FIELD KEY (`FieldRef`) - the same key
 * `presentation-schema` uses (`toSemanticFieldKey(format, sourceSegments)`, e.g. `"pro.critter.strength"`).
 * Referencing by semantic key (not display label, not byte offset) is what decouples the view from
 * byte order and from parser grouping, and composes with `FieldPresentation` (label/enum/flags per key).
 */

import { z } from "zod";

/** Semantic field key, e.g. `"pro.critter.strength"`. Resolved to a renderable row by the editor. */
export type FieldRef = string;

const fieldRefSchema = z.string().min(1);

/** A key/value list of fields (label + control), optionally laid out in N columns. */
/**
 * Fold a run of numeric fields into a single labelled inline row "Label  a / b / c" (small inputs with a
 * separator between) instead of one row each - e.g. CRE multiclass levels as "Level  1 / 2 / 3". Each join's
 * `fields` must all also appear in the surrounding block's `fields`; the joined row renders at the first
 * member's position and the rest are folded into it. Numeric fields only (the inputs are small number boxes).
 */
const joinSchema = z.strictObject({
    label: z.string().min(1),
    fields: z.array(fieldRefSchema).min(2),
    separator: z.string().default(" / "),
});

const fieldsBlockSchema = z.strictObject({
    kind: z.literal("fields"),
    fields: z.array(fieldRefSchema).min(1),
    columns: z.number().int().positive().optional(),
    joins: z.array(joinSchema).optional(),
    /** Fixed label-column width, in `ch`. By default the label track is `max-content` - it hugs the widest
     * current label, which is fine when labels are static. Set this where a label is REWRITTEN at runtime (the
     * effect detail relabels parameter1/parameter2 per opcode): a fixed track keeps the value columns from
     * jumping left/right as the label text changes. Sized to the common longest label; a rare longer one wraps
     * (a local row-height change) rather than shifting the columns. */
    labelWidthCh: z.number().int().positive().optional(),
});

/**
 * A boxed, labelled subgroup of fields inside a panel - a fieldset with a legend, the same box chrome as a
 * flag group. Use to nest a coherent cluster (e.g. CRE class: the CLASS.IDS dropdown, kit, and the multiclass
 * Level row) inside a larger panel. Place it after the panel's plain fields block and set the panel `stack`
 * flag so the subgroup sits below those fields rather than beside them.
 */
const fieldGroupBlockSchema = z.strictObject({
    kind: z.literal("group"),
    label: z.string().min(1),
    fields: z.array(fieldRefSchema).min(1),
    columns: z.number().int().positive().optional(),
    joins: z.array(joinSchema).optional(),
});

/** One flags field rendered as N vertical checkbox columns. */
const flagsBlockSchema = z.strictObject({
    kind: z.literal("flags"),
    field: fieldRefSchema,
    columns: z.number().int().positive().optional(),
    /** Spread the checkbox columns edge-to-edge across the panel width instead of clumping them left. Use for a
     * wide full-width flag panel (e.g. CRE Status Flags) whose columns would otherwise leave dead space on the
     * right. Leave off for narrow flag groups, where spreading just opens a gap between the columns. */
    spread: z.boolean().optional(),
    /** Optional hover tooltip per flag, keyed by the flag's label (the name in the field's flag table).
     * Descriptions are presentation text and live here in the layout, not in the parser/spec. */
    descriptions: z.record(z.string(), z.string()).optional(),
    /** Optional DISPLAY-label override per flag, keyed by the flag's canonical table name. The canonical name
     * (the key in the spec's flag table) is the round-trip / canonical-document identifier and is unchanged;
     * this only swaps what the checkbox shows. Use it to humanize a flag table authored with terse/CamelCase
     * names (e.g. MAP `SkipElevation0Tiles` -> "Skip elevation 0 tiles") without touching the canonical keys. */
    labels: z.record(z.string(), z.string()).optional(),
});

/** A flat multi-column grid of label+value cells (e.g. skills). */
const gridBlockSchema = z.strictObject({
    kind: z.literal("grid"),
    columns: z.number().int().positive(),
    items: z.array(fieldRefSchema).min(1),
});

/**
 * A 2D matrix: fixed-width column-groups (e.g. Primary / Secondary), each a sub-table whose rows are
 * labelled (e.g. "Strength") and whose cells map a value-column key (e.g. "base" / "bonus") to a FieldRef.
 */
const matrixBlockSchema = z.strictObject({
    kind: z.literal("matrix"),
    valueColumns: z.array(z.strictObject({ key: z.string().min(1), label: z.string() })).min(1),
    groups: z
        .array(
            z.strictObject({
                label: z.string(),
                rows: z
                    .array(
                        z.strictObject({
                            label: z.string(),
                            cells: z.record(z.string(), fieldRefSchema),
                        }),
                    )
                    .min(1),
            }),
        )
        .min(1),
    columnWidthPx: z.number().int().positive().optional(),
});

/**
 * Blocks valid inside a list entry's detail layout: the scalar/flag/table block kinds, but NOT `list` (a
 * detail pane never nests another variable-length section) or `raw`. A detail variant is the per-entry
 * presentation a master-detail list applies to its SELECTED entry, so the same record renders identically
 * whether it stands alone (its own format) or is embedded in a list (e.g. an EFF v2 effect, standalone or
 * inside a CRE). Defined before `listBlockSchema` so the list block can reference detail rows without the
 * full block union recursing back into `list`.
 */
const detailBlockSchema = z.discriminatedUnion("kind", [
    fieldsBlockSchema,
    fieldGroupBlockSchema,
    flagsBlockSchema,
    gridBlockSchema,
    matrixBlockSchema,
]);
const detailPanelSchema = z.strictObject({
    title: z.string().optional(),
    blocks: z.array(detailBlockSchema).min(1),
    widthPx: z.number().int().positive().optional(),
    fit: z.boolean().optional(),
    stack: z.boolean().optional(),
    /** Override the horizontal gap (px) between this panel's side-by-side blocks (default 16). Use when a
     *  panel lays several columns of blocks directly (no per-column group boxes) and wants them spaced wider. */
    colGapPx: z.number().int().positive().optional(),
});
const detailRowSchema = z.strictObject({ panels: z.array(detailPanelSchema).min(1) });

/**
 * A variable-length array section (ITM/CRE/MAP lists). Renders via the window/getChildren path keyed by
 * `sectionKey` (the depth-0 model group name). The structure-op affordances are declared here as data:
 * `canAdd` (the section toolbar offers "+ add") and `canModify` (per-entry insert/duplicate/move/remove).
 * These replace the former `BinaryFormatAdapter.isAddableArray`/`isModifiableArray` presentation predicates
 * (the adapter now holds only data concerns); the byte-builders still validate the arrayPath internally.
 *
 * `detailVariant` (master-detail only) declares the shared layout the SELECTED entry renders through - the
 * same fragment its standalone format uses - instead of a generic auto-form. Its field refs resolve against
 * a per-entry field map (the selected entry's subtree keyed by semantic field key), so a fragment authored
 * once is reused verbatim. When the selected entry does not carry every field the variant references (e.g. a
 * shorter record kind under a longer variant), the editor falls back to the auto-form rather than rendering a
 * partial.
 */
const listBlockSchema = z.strictObject({
    kind: z.literal("list"),
    sectionKey: z.string().min(1),
    render: z.enum(["inline", "master-detail"]),
    canAdd: z.boolean().default(false),
    canModify: z.boolean().default(false),
    /**
     * When set, each entry's detail pane offers an "add a `childAddSection` entry to THIS entry" action - an
     * owner-scoped child add routed through `BinaryFormatAdapter.buildAddChildEntryBytes`. Used by the ITM/SPL
     * Abilities list to add an effect to a specific ability (`childAddSection: "Effects"`), reaching an
     * effect-less ability the flat insert-relative path cannot. The named section is the child collection.
     */
    childAddSection: z.string().min(1).optional(),
    detailVariant: z.array(detailRowSchema).min(1).optional(),
    /**
     * Additional candidate variants for a list whose entries can be one of SEVERAL record kinds under the same
     * section (e.g. CRE Effects: a file embeds EFF v2 OR the older EFF v1 by `effStructureVersion`). The detail
     * pane renders the FIRST of `[detailVariant, ...detailVariantFallbacks]` whose field refs all resolve
     * against the selected entry, else the auto-form. The primary `detailVariant` is the common case; a fallback
     * is the shorter/older record's fragment, which the primary cleanly declines (its refs are absent).
     */
    detailVariantFallbacks: z.array(z.array(detailRowSchema).min(1)).optional(),
    /**
     * When set, the SELECTED entry's detail also renders an owner-scoped child list - a mini master-detail of
     * the entry's variable-length nested collection, with its own add/remove. Used by the MAP object detail to
     * edit a map object's nested `inventory` (a list of item-objects). The entry groups matching `entryPrefix`
     * are pulled out of the auto-form and shown as the mini-list instead, so they are not rendered twice.
     * `childSection` is the op-routing name (matches `buildAddChildEntryBytes`/`buildRemoveChildEntryBytes`).
     */
    childList: z
        .strictObject({
            childSection: z.string().min(1), // op routing name, e.g. "Inventory"
            entryPrefix: z.string().min(1), // entry group-name prefix in the model, e.g. "Inventory Entry"
            title: z.string().min(1), // section heading, e.g. "Inventory"
            addLabel: z.string().min(1), // add-button text, e.g. "add item"
        })
        .optional(),
});

/**
 * Bitflags regrouped by SEMANTIC CATEGORY rather than by the wire-format byte that stores them - for fields
 * whose meaningful groupings cross byte boundaries (the ITM usability bytes: alignment/class/race bits are
 * scattered across all four bytes; the kit bytes: one base class's kits sit in several bytes). The block owns
 * the column layout: `columns` lay left-to-right, each column stacks one or more boxed, labelled subgroups,
 * and each checkbox names its own backing field + single-bit mask. The default checkbox label is the field's
 * own flag-table name (single source of truth); `label` overrides it for terser display (e.g. "Cleric of
 * Talos" -> "Talos" under a "Cleric" subgroup). Toggling composes back into the named byte, so the round-trip
 * is unchanged - this is pure presentation over the same per-byte flag fields a `flags` block would render.
 */
const flagGroupItemSchema = z.strictObject({
    field: fieldRefSchema,
    mask: z.number().int().positive(),
    label: z.string().optional(),
});
const flagGroupsBlockSchema = z.strictObject({
    kind: z.literal("flagGroups"),
    /** Render "Select all" / "Deselect all" controls that set or clear every bit the block references (across
     *  all its backing byte fields). For a panel of restriction flags where toggling the whole set at once is
     *  common (e.g. ITM Unusable By / Unusable By Kit). */
    bulkSelect: z.boolean().optional(),
    columns: z
        .array(
            z
                .array(
                    z.strictObject({
                        label: z.string(),
                        items: z.array(flagGroupItemSchema).min(1),
                        /** Split this subgroup's checkboxes into N vertical sub-columns (column-major, order
                         *  preserved) instead of one tall stack - for a large category like the ~19-member
                         *  Class group. Defaults to 1. */
                        columns: z.number().int().positive().optional(),
                    }),
                )
                .min(1),
        )
        .min(1),
});

/** A hex/raw-bytes pane. Specified now; webview `RawBlock` is a stub (follow-up tier). */
const rawBlockSchema = z.strictObject({ kind: z.literal("raw") });

/**
 * The unified CRE spellbook: a single bespoke block that joins the three spell tables (Known Spells, Spell
 * Memorization Info, Memorized Spells) into a spell-type -> level view. Unlike the other blocks it does not
 * declare its inputs - the host-side `projectSpellbook` reads the three fixed CRE sections directly and ships a
 * `SpellbookView` the webview `SpellbookBlock` renders. CRE-specific (the only format with this table triad).
 */
const spellbookBlockSchema = z.strictObject({ kind: z.literal("spellbook") });

const layoutBlockSchema = z.discriminatedUnion("kind", [
    fieldsBlockSchema,
    fieldGroupBlockSchema,
    flagsBlockSchema,
    flagGroupsBlockSchema,
    gridBlockSchema,
    matrixBlockSchema,
    listBlockSchema,
    spellbookBlockSchema,
    rawBlockSchema,
]);

/**
 * A titled panel containing one or more blocks laid left-to-right. Multiple blocks let a single panel
 * hold, e.g., a fields list plus two flag columns (the critter Header). `widthPx` hugs the panel to a
 * fixed width; `fit` hugs it to its content (no growing to fill the row) - use it for a small panel (a
 * couple of fields/checkboxes) sharing a row with a larger one, so the small panel stays compact and the
 * larger field panel absorbs the leftover width instead of both stretching.
 */
const layoutPanelSchema = z.strictObject({
    title: z.string().optional(),
    blocks: z.array(layoutBlockSchema).min(1),
    widthPx: z.number().int().positive().optional(),
    fit: z.boolean().optional(),
    /** Stack the panel's blocks vertically instead of left-to-right - for a panel that holds a fields block
     *  plus a boxed subgroup (kind "group") that should sit below it, not beside it. */
    stack: z.boolean().optional(),
    /** Override the horizontal gap (px) between this panel's side-by-side blocks (default 16). */
    colGapPx: z.number().int().positive().optional(),
});

/** A row of panels, left-to-right, clumped left. */
const layoutRowSchema = z.strictObject({ panels: z.array(layoutPanelSchema).min(1) });

/**
 * A subtab: a leaf tab whose body is always rows (subtabs do not nest further). `countFrom` shows a count
 * badge sourced from the named list section's resolved entry count (e.g. "Known (12)").
 */
const layoutSubTabSchema = z.strictObject({
    id: z.string().min(1),
    label: z.string().min(1),
    icon: z.string().optional(),
    countFrom: z.string().min(1).optional(),
    // Two depth-0 group names whose child counts render as an "x/y" badge (e.g. the Spells tab's joined spell
    // tables, which are not single list sections countFrom can read).
    countFromPair: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
    rows: z.array(layoutRowSchema).min(1),
});

/** A top-level tab. Its body is EITHER rows or one level of subtabs (never both). */
const layoutTabSchema = z
    .strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        icon: z.string().optional(),
        countFrom: z.string().min(1).optional(),
        countFromPair: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
        rows: z.array(layoutRowSchema).min(1).optional(),
        tabs: z.array(layoutSubTabSchema).min(1).optional(),
    })
    .refine((t) => (t.rows === undefined) !== (t.tabs === undefined), "a tab must have rows xor subtabs");

/**
 * A variant is either a flat list of rows (untabbed - the default for formats that fit one page) or a set of
 * top-level tabs. Tabs are how a large format (CRE, MAP) is broken up so the default view fits one page.
 */
const layoutVariantSchema = z
    .strictObject({
        rows: z.array(layoutRowSchema).min(1).optional(),
        tabs: z.array(layoutTabSchema).min(1).optional(),
    })
    .refine((v) => (v.rows === undefined) !== (v.tabs === undefined), "a variant must have rows xor tabs");

/**
 * A format's full layout: one variant per object/sub type the parser can report (PRO dispatches by
 * object type and item/scenery subtype). The active variant is chosen by the `variantId` the parser
 * stamps on the parse result; absent that, the first declared variant is used.
 */
export const formatLayoutSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.string().min(1),
    variants: z.record(z.string(), layoutVariantSchema),
    /** Content hugs and clumps left within the pane up to this width (~900 default in the renderer). */
    maxContentWidthPx: z.number().int().positive().optional(),
    /**
     * Display-label overrides keyed by semantic field key (`FieldRef`). Applied at resolve time to a field's
     * display NAME only - the parse name (and therefore the field's semantic-key identity) is unchanged, so
     * every layout ref keeps resolving. This is the correct layer for dropping a category prefix the panel
     * title already states ("Resist Fire" -> "Fire"), expanding abbreviations, or naming positional slots:
     * none of those may touch identity, and the parser/rebuild stay byte-faithful. A key with no entry keeps
     * its humanized name.
     */
    labels: z.record(fieldRefSchema, z.string()).optional(),
    /**
     * Semantic field keys rendered read-only - shown for context but non-editable. Use for the
     * variant-discriminating fields (PRO `objectType` / `subType`): they must stay visible, but editing them
     * would desync the stamped variant from the bytes (the half-broken "change type" path), so the editor
     * disables them. Applied in resolveLayout to the resolved row's `editable`.
     */
    readOnlyFields: z.array(fieldRefSchema).optional(),
});

export type LayoutBlock = z.infer<typeof layoutBlockSchema>;
export type LayoutPanel = z.infer<typeof layoutPanelSchema>;
export type LayoutRow = z.infer<typeof layoutRowSchema>;
export type DetailBlock = z.infer<typeof detailBlockSchema>;
export type DetailPanel = z.infer<typeof detailPanelSchema>;
export type DetailRow = z.infer<typeof detailRowSchema>;
export type LayoutChildList = NonNullable<z.infer<typeof listBlockSchema>["childList"]>;
export type LayoutSubTab = z.infer<typeof layoutSubTabSchema>;
export type LayoutTab = z.infer<typeof layoutTabSchema>;
export type LayoutVariant = z.infer<typeof layoutVariantSchema>;
export type FormatLayout = z.infer<typeof formatLayoutSchema>;

/**
 * All rows of a variant, flattening tabs and subtabs. For code that must see every row regardless of tab
 * grouping - field resolution, list-section discovery, structural guardrails. The renderer walks the
 * structured tabs instead (so it can render the tab strip), but resolution is tab-agnostic.
 */
export function variantRows(variant: LayoutVariant): LayoutRow[] {
    if (variant.rows) return variant.rows;
    return (variant.tabs ?? []).flatMap((t) => t.rows ?? (t.tabs ?? []).flatMap((st) => st.rows));
}
