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
export interface ScalarFieldSpec {
    readonly kind?: "scalar";
    readonly codec: ISchema<number>;
    readonly domain?: { readonly min: number; readonly max: number };
    readonly enum?: Readonly<Record<number, string>>;
    /**
     * When `true`, treat `enum` as an advisory display lookup rather than a
     * closed value set: walkStruct still resolves named values, but the
     * `toZodSchema` strict-mode refinement does NOT enforce membership.
     * Used for fields whose value space is open by design — e.g. effect
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
     * stays flat — each part is a peer scalar entry, same as a byte-aligned
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
     * masked to its width before being shifted into the wire word — the
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
 *   - `count: N` — fixed wire length.
 *   - `count: { fromField: "X" }` — same-struct sibling: count and array
 *     decoded together; zod refinement keeps the two in sync at save time.
 *   - `count: { fromCtx: (ctx) => N }` — cross-struct: count decoded earlier
 *     in the file (e.g., a header field) and supplied as `ctx` at the
 *     spec's `read()` call. The orchestrator owns the binding; zod cannot
 *     refine across structs, so out-of-band count drift is the
 *     orchestrator's concern.
 */
export function arraySpec<Ctx = never>(args: {
    element: ScalarFieldSpec;
    count: number | { fromField: string } | { fromCtx: (ctx: Ctx) => number };
    addable?: boolean;
    removable?: boolean;
    defaultElement?: () => unknown;
}): ArrayFieldSpec {
    return {
        kind: "array",
        element: args.element,
        // Re-narrow the public never-seed parameter for storage; the variance
        // would otherwise reject ctx being typed wider than `never` here.
        count: args.count as ArrayFieldSpec["count"],
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
 * the spec declarations in sync — adding a field to the spec automatically
 * adds it to the data type, removing the prior duplication between
 * `interface FooData` and the spec field list.
 */
export type SpecData<S extends Record<string, FieldSpec>> = {
    -readonly [K in keyof S]: S[K] extends ArrayFieldSpec ? number[] : S[K] extends CharsFieldSpec ? string : number;
};

/**
 * Linked structures: when an array field declares
 * `count: { fromField: "X" }`, the scalar field `X` is the on-wire count
 * paired with that array. The canonical-write path treats `X` as derived
 * from the array's length: callers (or `enforceLinkedCounts` below) must
 * recompute `X` from `doc.array.length` before serializing, and the zod
 * schema rejects documents where the two diverge. This keeps "add an item
 * to a map" a single semantic edit on the array — the count field tracks
 * automatically — while still surfacing the count in the canonical document
 * for visibility and round-trip JSON edits.
 *
 * Currently no spec uses lengthFrom arrays at runtime; the MAP migration
 * (variable-length tile/script/object sections) is the first consumer.
 *
 * Walks the spec and copies `doc[arrayName].length` into the linked count
 * field. Returns a new object; does not mutate `doc`. Use this as the
 * pre-serialization step in canonical-writer flows that have linked counts.
 */
export function enforceLinkedCounts<S extends Record<string, FieldSpec>, D extends Record<string, unknown>>(
    spec: S,
    doc: D,
): D {
    let out: D | undefined;
    for (const key of Object.keys(spec) as (keyof S & string)[]) {
        const fs = spec[key];
        if (!fs || !isArraySpec(fs)) continue;
        if (!isFromFieldCount(fs.count)) continue;
        const countField = fs.count.fromField;
        const arr = doc[key];
        if (!Array.isArray(arr)) continue;
        const desired = arr.length;
        if (doc[countField] === desired) continue;
        if (!out) out = { ...doc };
        (out as Record<string, unknown>)[countField] = desired;
    }
    return out ?? doc;
}
