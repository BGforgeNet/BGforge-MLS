import type { ISchema } from "typed-binary";

/**
 * Per-field declaration for the data layer of a binary format.
 *
 * One of these per field per struct. Drives every downstream artifact: the
 * typed-binary read/write codec, the zod canonical-document validator, the
 * binary-editor display annotation, and the `DOMAIN_RANGES` clamp/validate
 * table. See `tmp/binary-spec-plan.md` for the architecture.
 */
/**
 * Exported so the published `@bgforge/binary` `.d.ts` can name types that
 * inferred from `arraySpec(...)` calls in spec modules; not imported from
 * source.
 *
 * @public
 */
/**
 * Semantic role of a scalar field. Defaults to `"data"` (user-editable game
 * value). Non-`"data"` roles mark fields the user must not hand-edit:
 *
 * - `"derivedCount"` - the length of a sibling array.
 * - `"derivedOffset"` - the byte offset of a section within the file.
 * - `"derivedIndex"` - the index of a record into a sibling table.
 * - `"reserved"` - engine-set value the user must not edit, but the writer
 *   has no derivation formula for (unknown fields, runtime pointers,
 *   tool-generated metadata). Editor lock applies; enforceDerivedFields and
 *   validateDerivedFields are no-ops on these - the writer trusts whatever
 *   value was on the wire and round-trips it byte-identically.
 *
 * The role flows into three downstream behaviours from one declaration:
 *   - presentation derivation emits `editable: false` (locks the editor input);
 *   - canonical-write recomputes the field from doc state (derived roles);
 *   - canonical-read zod refinement asserts the on-disk value matches truth.
 *
 * `derivedFrom` names the source the canonical-write recompute reads.
 * Reserved fields omit it; the field's current value is the source of truth.
 */
export type FieldRole = "data" | "derivedCount" | "derivedOffset" | "derivedIndex" | "reserved";

export type DerivedFrom = { readonly array: string } | { readonly section: string } | { readonly table: string };

export interface ScalarFieldSpec {
    readonly kind?: "scalar";
    readonly codec: ISchema<number>;
    readonly domain?: { readonly min: number; readonly max: number };
    readonly enum?: Readonly<Record<number, string>>;
    readonly role?: FieldRole;
    readonly derivedFrom?: DerivedFrom;
    /**
     * When `true`, treat `enum` as an advisory display lookup rather than a
     * closed value set: walkStruct still resolves named values, but the
     * `toZodSchema` strict-mode refinement does NOT enforce membership.
     * Used for fields whose value space is open by design - e.g. effect
     * opcodes (mods can define new ones; the engine accepts any 16-bit
     * value) or item types backed by `itemtype.2da` (mod-extensible). The
     * default (`undefined`) keeps the existing strict-enforce behaviour
     * suitable for closed enums like PRO `objectType`.
     */
    readonly enumOpen?: boolean;
    readonly flags?: Readonly<Record<number, string>>;
    /**
     * Bit-packed wire layout: this field is one part of a multi-field packed
     * slot named `packedAs`. All ScalarFieldSpec entries sharing one
     * `packedAs` value share one wire codec read; the canonical-doc shape
     * stays flat - each part is a peer scalar entry, same as a byte-aligned
     * split (e.g. `objectType`+`objectId`). The wire codec is the codec
     * declared on every part (they must match); each part must declare a
     * `bitRange`. Parts of one group must appear consecutively in spec
     * declaration order, must share the same `codec`, and their bit ranges
     * must not overlap. Gaps are permitted (read as 0, written as 0).
     */
    readonly packedAs?: string;
    /**
     * `[bitOffset, bitWidth]`, LSB=0 numbering. `bitOffset + bitWidth` must
     * fit within the wire codec's width in bits. On write, each part is
     * masked to its width before being shifted into the wire word - the
     * caller (zod refinement, walker validation) is responsible for the
     * value-range check; this layer only enforces the bit-width invariant.
     */
    readonly bitRange?: readonly [bitOffset: number, bitWidth: number];
}

/**
 * Fixed-count or length-from-field array of scalar entries. Covers
 * `field_3C: u32 × 44` (count) and MAP variable-length sections (lengthFrom).
 */
/**
 * Exported so the published `@bgforge/binary` `.d.ts` can name types
 * inferred from `arraySpec(...)` calls in spec modules; not imported from
 * source.
 *
 * @public
 */
export interface ArrayFieldSpec {
    readonly kind: "array";
    readonly element: ScalarFieldSpec;
    readonly count: number | { readonly fromField: string } | { readonly fromCtx: (ctx: never) => number };
    /**
     * How the display walker should render this array. Discriminates the
     * single arraySpec catch-all into the cases that have meaningfully
     * different display shapes:
     *
     * - `"bytes"` (default) - opaque byte run / trailing reserve. Walker
     *   emits a single `(N values)` summary row of type `padding`. Used for
     *   genuine reserves like `field_3C` (44×i32 trailing space) and
     *   pre-`charsSpec`-era u8[] strings.
     * - `"slots"` - N elements with stable per-index semantic labels (e.g.
     *   melee animation's `Overhand` / `Backhand` / `Thrust`). Walker emits a
     *   `ParsedGroup` named after the field, with one child per element
     *   labelled from `slotLabels`. The element values stay individually
     *   rendered (type comes from `element.codec`), so flag/enum tables on
     *   the element apply per child.
     *
     * The single `arraySpec(...)` constructor accepts both shapes via the
     * `view` discriminator; the data shape (number[]) is unchanged.
     */
    readonly view?: "bytes" | "slots";
    readonly slotLabels?: readonly string[];
    /**
     * Optional per-slot element override. When supplied, the walker uses
     * `slotElements[i]` for slot `i` instead of the shared `element` spec.
     * Use when slots have semantically different content - e.g. an ITM
     * `usabilityFlags: u8[4]` where each byte carries a distinct flag table
     * (per IESDP class / race / kit breakdown). Wire codec must remain
     * identical across slots; only the enum / flags / domain annotations
     * may differ.
     */
    readonly slotElements?: readonly ScalarFieldSpec[];
    /**
     * Capability flags consumed by the binary editor's add/remove pathway.
     * The spec is the source of truth for whether an array accepts user
     * insertion/deletion; format adapters look this up rather than maintain
     * a parallel capability table. `defaultElement` produces the value to
     * insert (typed-binary primitive types are numeric; richer formats can
     * supply structured defaults in the same slot).
     */
    readonly addable?: boolean;
    readonly removable?: boolean;
    readonly defaultElement?: () => unknown;
}

/**
 * Fixed-size ASCII string stored as N raw bytes on the wire. Covers IESDP
 * `resref` (8 bytes) and `char array, length: N` (signature, version, names).
 *
 * The wire layout is N raw u8 bytes. The data layer surfaces a `string`:
 * - `toTypedBinarySchema` reads N bytes and converts to a NUL-stripped string
 *   on read; on write, encodes the string to ASCII, NUL-pads or truncates to N.
 * - `toZodSchema` produces `z.string().max(N)`.
 * - `walkStruct` renders the string directly in the display tree.
 * - `SpecData<S>` projects the field as `string`.
 *
 * Lifting this to a primitive (rather than a presentation hint over u8[N]) is
 * what makes JSON snapshot diffs single-line for resref / signature changes.
 */
/**
 * Exported so the published `@bgforge/binary` `.d.ts` can name types
 * inferred from `charsSpec(...)` calls in spec modules; not imported from
 * source.
 *
 * @public
 */
export interface CharsFieldSpec {
    readonly kind: "chars";
    readonly count: number;
}

export type FieldSpec = ScalarFieldSpec | ArrayFieldSpec | CharsFieldSpec;

export type StructSpec<T> = { readonly [K in keyof T]: FieldSpec };

/**
 * Construct an array field spec.
 *
 * Length sources, in order of locality:
 *   - `count: N` - fixed wire length.
 *   - `count: { fromField: "X" }` - same-struct sibling: count and array
 *     decoded together; zod refinement keeps the two in sync at save time.
 *   - `count: { fromCtx: (ctx) => N }` - cross-struct: count decoded earlier
 *     in the file (e.g., a header field) and supplied as `ctx` at the
 *     spec's `read()` call. The orchestrator owns the binding; zod cannot
 *     refine across structs, so out-of-band count drift is the
 *     orchestrator's concern.
 */
export function arraySpec<Ctx = never>(args: {
    element: ScalarFieldSpec;
    count: number | { fromField: string } | { fromCtx: (ctx: Ctx) => number };
    view?: "bytes" | "slots";
    slotLabels?: readonly string[];
    slotElements?: readonly ScalarFieldSpec[];
    addable?: boolean;
    removable?: boolean;
    defaultElement?: () => unknown;
}): ArrayFieldSpec {
    if (args.view === "slots") {
        if (!args.slotLabels) {
            throw new Error("arraySpec view='slots' requires slotLabels");
        }
        if (typeof args.count === "number" && args.slotLabels.length !== args.count) {
            throw new Error(
                `arraySpec view='slots' slotLabels.length (${args.slotLabels.length}) must equal count (${args.count})`,
            );
        }
        if (args.slotElements && args.slotElements.length !== args.slotLabels.length) {
            throw new Error(
                `arraySpec view='slots' slotElements.length (${args.slotElements.length}) must equal slotLabels.length (${args.slotLabels.length})`,
            );
        }
    }
    return {
        kind: "array",
        element: args.element,
        // Re-narrow the public never-seed parameter for storage; the variance
        // would otherwise reject ctx being typed wider than `never` here.
        count: args.count as ArrayFieldSpec["count"],
        ...(args.view !== undefined ? { view: args.view } : {}),
        ...(args.slotLabels !== undefined ? { slotLabels: args.slotLabels } : {}),
        ...(args.slotElements !== undefined ? { slotElements: args.slotElements } : {}),
        ...(args.addable !== undefined ? { addable: args.addable } : {}),
        ...(args.removable !== undefined ? { removable: args.removable } : {}),
        ...(args.defaultElement !== undefined ? { defaultElement: args.defaultElement } : {}),
    };
}

export function isArraySpec(spec: FieldSpec): spec is ArrayFieldSpec {
    return spec.kind === "array";
}

export function isCharsSpec(spec: FieldSpec): spec is CharsFieldSpec {
    return spec.kind === "chars";
}

/** Construct a fixed-size chars (ASCII string) field spec. */
export function charsSpec(count: number): CharsFieldSpec {
    if (!Number.isInteger(count) || count < 1) {
        throw new Error(`charsSpec requires a positive integer count; got ${count}`);
    }
    return { kind: "chars", count };
}

export function isFromFieldCount(count: ArrayFieldSpec["count"]): count is { readonly fromField: string } {
    return typeof count === "object" && "fromField" in count;
}

export function isFromCtxCount(count: ArrayFieldSpec["count"]): count is { readonly fromCtx: (ctx: never) => number } {
    return typeof count === "object" && "fromCtx" in count;
}

/**
 * Type-level projection from a spec object to the data shape it describes.
 *
 * Use as `type FooData = SpecData<typeof fooSpec>;` to keep the data shape and
 * the spec declarations in sync - adding a field to the spec automatically
 * adds it to the data type, removing the prior duplication between
 * `interface FooData` and the spec field list.
 *
 * Scalars with a `flags` annotation project to `string[]` - a flat sorted
 * array whose entries are either named slugs from the spec table or
 * `bit<N>` sentinels for set bits the table doesn't name. The exact name
 * set is loose at the type level (the spec's flag table values are
 * `Record<number, string>` and cannot be lifted to literal types without
 * `as const` migration); strict structural validation lives in the zod schema.
 */
export type SpecData<S extends Record<string, FieldSpec>> = {
    -readonly [K in keyof S]: S[K] extends ArrayFieldSpec
        ? number[]
        : S[K] extends CharsFieldSpec
          ? string
          : S[K] extends ScalarFieldSpec
            ? S[K] extends { readonly flags: Readonly<Record<number, string>> }
                ? string[]
                : number
            : never;
};

/**
 * Context for cross-struct recompute. The format-specific canonical writer
 * assembles this from the surrounding doc shape (which arrays exist, what
 * byte offsets the sections land at, where each record sits in a global
 * table). The helper consults the context for any role-tagged scalar whose
 * `derivedFrom` source is not a sibling field of the struct being walked.
 */
export interface DerivedFieldsContext {
    readonly arrays?: Readonly<Record<string, readonly unknown[]>>;
    readonly sectionOffsets?: Readonly<Record<string, number>>;
    readonly tableIndexes?: Readonly<Record<string, number>>;
}

/**
 * Recompute derived (structural) scalar fields from doc state.
 *
 * Two declaration shapes converge here:
 *   - **Sibling array linkage** - `arraySpec({ count: { fromField: "X" } })`.
 *     The scalar field `X` is the on-wire count paired with the same-struct
 *     array. The helper sets `doc[X] = doc[arrayKey].length`. This is the
 *     within-struct shape used by MAP variable-length sections.
 *   - **Cross-struct role** - `{ codec, role: "derivedCount" | "derivedOffset"
 *     | "derivedIndex", derivedFrom: { array | section | table } }`. The
 *     source name resolves against the supplied `ctx` (`ctx.arrays[name]`
 *     for counts, `ctx.sectionOffsets[name]` for offsets, etc.) rather
 *     than a sibling field. Used by ITM/SPL where counts and offsets in
 *     the header reference the doc-level abilities/effects arrays.
 *
 * Returns a new object when any field changed; otherwise returns `doc`
 * unchanged (reference-equal). Does not mutate `doc`. Use this as the
 * pre-serialization step in canonical-writer flows.
 *
 * Permissive on missing context: a role-tagged field whose source is not
 * supplied in `ctx` is left as-is. The zod consistency refinement (when
 * present) is the place to assert truth at validation time.
 */
/**
 * Read-side counterpart to `enforceDerivedFields`: walk the same role-driven
 * rules and return the list of fields whose doc value diverges from the
 * recomputed truth. Empty list means the doc is internally consistent for
 * the supplied ctx.
 *
 * Used by canonical-document zod refinements to reject hand-edited JSON
 * snapshots that smuggle inconsistent structural metadata into the file.
 * Permissive on missing ctx: a field whose derivedFrom source is not
 * supplied is omitted from the report (no truth to compare against).
 */
export interface DerivedFieldMismatch {
    readonly field: string;
    readonly actual: unknown;
    readonly expected: number;
}

export function validateDerivedFields<S extends Record<string, FieldSpec>, D extends Record<string, unknown>>(
    spec: S,
    doc: D,
    ctx: DerivedFieldsContext = {},
): DerivedFieldMismatch[] {
    const recomputed = enforceDerivedFields(spec, doc, ctx);
    if (recomputed === doc) return [];
    const mismatches: DerivedFieldMismatch[] = [];
    for (const key of Object.keys(spec) as (keyof S & string)[]) {
        if (recomputed[key] === doc[key]) continue;
        mismatches.push({
            field: key,
            actual: doc[key],
            expected: recomputed[key] as number,
        });
    }
    return mismatches;
}

export function enforceDerivedFields<S extends Record<string, FieldSpec>, D extends Record<string, unknown>>(
    spec: S,
    doc: D,
    ctx: DerivedFieldsContext = {},
): D {
    let out: D | undefined;
    const set = (field: string, value: number) => {
        if (doc[field] === value) return;
        if (!out) out = { ...doc };
        (out as Record<string, unknown>)[field] = value;
    };

    for (const key of Object.keys(spec) as (keyof S & string)[]) {
        const fs = spec[key];
        if (!fs) continue;

        // Within-struct linkage: array spec names its sibling count field.
        if (isArraySpec(fs)) {
            if (!isFromFieldCount(fs.count)) continue;
            const arr = doc[key];
            if (!Array.isArray(arr)) continue;
            set(fs.count.fromField, arr.length);
            continue;
        }

        // Cross-struct linkage: scalar role + ctx-supplied source.
        if (isCharsSpec(fs) || !fs.role || fs.role === "data" || !fs.derivedFrom) continue;
        const from = fs.derivedFrom;
        if (fs.role === "derivedCount" && "array" in from) {
            const arr = ctx.arrays?.[from.array];
            if (Array.isArray(arr)) set(key, arr.length);
        } else if (fs.role === "derivedOffset" && "section" in from) {
            const offset = ctx.sectionOffsets?.[from.section];
            if (typeof offset === "number") set(key, offset);
        } else if (fs.role === "derivedIndex" && "table" in from) {
            const index = ctx.tableIndexes?.[from.table];
            if (typeof index === "number") set(key, index);
        }
    }
    return out ?? doc;
}
