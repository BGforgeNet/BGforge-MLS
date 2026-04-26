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
