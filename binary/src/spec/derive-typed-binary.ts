import { object, arrayOf, type ISchema, type AnySchema } from "typed-binary";
import { isArraySpec, type FieldSpec, type SpecData } from "./types";

/**
 * Derive a typed-binary `object({...})` schema from a `StructSpec`.
 *
 * For scalar fields, each entry maps to its declared codec. For fixed-count
 * arrays, emits `arrayOf(element, count)`. Length-from-field arrays cannot be
 * expressed in raw typed-binary (which has no cross-field dependency); those
 * are handled by the higher-level walker. See `tmp/binary-spec-plan.md`.
 *
 * Results are cached by spec reference so repeated derivations on the same
 * spec object return the same schema instance.
 */
const cache = new WeakMap<object, ISchema<unknown>>();

export function toTypedBinarySchema<S extends Record<string, FieldSpec>>(spec: S): ISchema<SpecData<S>> {
    const cached = cache.get(spec);
    if (cached) return cached as ISchema<SpecData<S>>;

    const props: Record<string, AnySchema> = {};
    for (const key of Object.keys(spec)) {
        props[key] = fieldSpecToCodec(spec[key]!);
    }
    const schema = object(props) as unknown as ISchema<SpecData<S>>;
    cache.set(spec, schema as ISchema<unknown>);
    return schema;
}

function fieldSpecToCodec(fs: FieldSpec): AnySchema {
    if (isArraySpec(fs)) {
        if (typeof fs.count === "number") {
            return arrayOf(fs.element.codec, fs.count) as unknown as AnySchema;
        }
        throw new Error("lengthFrom arrays are not supported in raw schema derivation; use the walker.");
    }
    return fs.codec as unknown as AnySchema;
}
