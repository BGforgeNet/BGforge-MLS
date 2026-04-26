import type { ISchema } from "typed-binary";

/**
 * Per-field declaration for the data layer of a binary format.
 *
 * One of these per field per struct. Drives every downstream artifact: the
 * typed-binary read/write codec, the zod canonical-document validator, the
 * binary-editor display annotation, and the `DOMAIN_RANGES` clamp/validate
 * table. See `tmp/binary-spec-plan.md` for the architecture.
 */
interface ScalarFieldSpec {
    readonly kind?: "scalar";
    readonly codec: ISchema<number>;
    readonly domain?: { readonly min: number; readonly max: number };
    readonly enum?: Readonly<Record<number, string>>;
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
interface ArrayFieldSpec {
    readonly kind: "array";
    readonly element: ScalarFieldSpec;
    readonly count: number | { readonly fromField: string };
}

export type FieldSpec = ScalarFieldSpec | ArrayFieldSpec;

export type StructSpec<T> = { readonly [K in keyof T]: FieldSpec };

export function arraySpec(args: { element: ScalarFieldSpec; count: number | { fromField: string } }): ArrayFieldSpec {
    return { kind: "array", element: args.element, count: args.count };
}

export function isArraySpec(spec: FieldSpec): spec is ArrayFieldSpec {
    return spec.kind === "array";
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
    -readonly [K in keyof S]: S[K] extends ArrayFieldSpec ? number[] : number;
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
        if (typeof fs.count === "number") continue;
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
