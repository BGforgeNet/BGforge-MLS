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
const fieldsBlockSchema = z.strictObject({
    kind: z.literal("fields"),
    fields: z.array(fieldRefSchema).min(1),
    columns: z.number().int().positive().optional(),
});

/** One flags field rendered as N vertical checkbox columns. */
const flagsBlockSchema = z.strictObject({
    kind: z.literal("flags"),
    field: fieldRefSchema,
    columns: z.number().int().positive().optional(),
    /** Optional hover tooltip per flag, keyed by the flag's label (the name in the field's flag table).
     * Descriptions are presentation text and live here in the layout, not in the parser/spec. */
    descriptions: z.record(z.string(), z.string()).optional(),
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
 * A variable-length array section (ITM/CRE/MAP lists). Renders via the window/getChildren path keyed by
 * `sectionKey` (the depth-0 model group name). The structure-op affordances are declared here as data:
 * `canAdd` (the section toolbar offers "+ add") and `canModify` (per-entry insert/duplicate/move/remove).
 * These replace the former `BinaryFormatAdapter.isAddableArray`/`isModifiableArray` presentation predicates
 * (the adapter now holds only data concerns); the byte-builders still validate the arrayPath internally.
 */
const listBlockSchema = z.strictObject({
    kind: z.literal("list"),
    sectionKey: z.string().min(1),
    render: z.enum(["inline", "master-detail"]),
    canAdd: z.boolean().default(false),
    canModify: z.boolean().default(false),
});

/** A hex/raw-bytes pane. Specified now; webview `RawBlock` is a stub (follow-up tier). */
const rawBlockSchema = z.strictObject({ kind: z.literal("raw") });

const layoutBlockSchema = z.discriminatedUnion("kind", [
    fieldsBlockSchema,
    flagsBlockSchema,
    gridBlockSchema,
    matrixBlockSchema,
    listBlockSchema,
    rawBlockSchema,
]);

/**
 * A titled panel containing one or more blocks laid left-to-right. Multiple blocks let a single panel
 * hold, e.g., a fields list plus two flag columns (the critter Header). `widthPx` hugs the panel to its
 * content rather than stretching.
 */
const layoutPanelSchema = z.strictObject({
    title: z.string().optional(),
    blocks: z.array(layoutBlockSchema).min(1),
    widthPx: z.number().int().positive().optional(),
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
    rows: z.array(layoutRowSchema).min(1),
});

/** A top-level tab. Its body is EITHER rows or one level of subtabs (never both). */
const layoutTabSchema = z
    .strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        icon: z.string().optional(),
        countFrom: z.string().min(1).optional(),
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
