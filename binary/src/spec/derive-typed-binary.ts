import {
    object,
    arrayOf,
    Schema,
    Measurer,
    type ISchema,
    type AnySchema,
    type ISerialInput,
    type ISerialOutput,
    type IMeasurer,
    type MaxValue,
} from "typed-binary";
import { codecByteLength } from "./codec-meta";
import { isArraySpec, type FieldSpec, type SpecData } from "./types";

/**
 * Derive a typed-binary `object({...})` schema from a `StructSpec`.
 *
 * For scalar fields, each entry maps to its declared codec. For fixed-count
 * arrays, emits `arrayOf(element, count)`. Length-from-field arrays cannot be
 * expressed in raw typed-binary (which has no cross-field dependency); those
 * are handled by the higher-level walker. See `tmp/binary-spec-plan.md`.
 *
 * When any field declares `packedAs`, falls through to `PackedStructSchema`
 * instead of `object({...})`: typed-binary's object reads each property
 * independently, but a bit-packed group needs one wire read distributed
 * across multiple flat data properties. The dispatch keeps the pure-scalar
 * case on the well-trodden `object({...})` path so packing is opt-in.
 *
 * Results are cached by spec reference so repeated derivations on the same
 * spec object return the same schema instance.
 */
const cache = new WeakMap<object, ISchema<unknown>>();

export function toTypedBinarySchema<S extends Record<string, FieldSpec>>(spec: S): ISchema<SpecData<S>> {
    const cached = cache.get(spec);
    if (cached) return cached as ISchema<SpecData<S>>;

    const hasPacked = Object.values(spec).some((f) => !isArraySpec(f) && f.packedAs !== undefined);

    let schema: ISchema<unknown>;
    if (hasPacked) {
        schema = new PackedStructSchema(spec);
    } else {
        const props: Record<string, AnySchema> = {};
        for (const key of Object.keys(spec)) {
            props[key] = fieldSpecToCodec(spec[key]!);
        }
        schema = object(props) as unknown as ISchema<unknown>;
    }
    cache.set(spec, schema);
    return schema as ISchema<SpecData<S>>;
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

interface PackedPart {
    readonly key: string;
    readonly bitOffset: number;
    readonly bitWidth: number;
}

type WireEntry =
    | { readonly kind: "plain"; readonly key: string; readonly codec: AnySchema; readonly bytes: number }
    | {
          readonly kind: "packed";
          readonly slot: string;
          readonly codec: ISchema<number>;
          readonly bytes: number;
          readonly parts: readonly PackedPart[];
      };

// Extends `Schema<unknown>` rather than `Schema<SpecData<S>>` to dodge the
// generic-`Parsed<T, Ctx>` simplification mismatch; the call site in
// `toTypedBinarySchema` casts back to `ISchema<SpecData<S>>` at the boundary.
class PackedStructSchema extends Schema<unknown> {
    readonly maxSize: number;
    private readonly entries: readonly WireEntry[];

    constructor(spec: Record<string, FieldSpec>) {
        super();
        this.entries = buildWireLayout(spec);
        this.maxSize = this.entries.reduce((sum, e) => sum + e.bytes, 0);
    }

    read(input: ISerialInput): unknown {
        const out: Record<string, unknown> = {};
        for (const entry of this.entries) {
            if (entry.kind === "plain") {
                out[entry.key] = (entry.codec as ISchema<unknown>).read(input);
            } else {
                const word = entry.codec.read(input);
                for (const p of entry.parts) {
                    const mask = bitMask(p.bitWidth);
                    out[p.key] = (word >>> p.bitOffset) & mask;
                }
            }
        }
        return out;
    }

    write(output: ISerialOutput, value: unknown): void {
        const v = value as Record<string, unknown>;
        for (const entry of this.entries) {
            if (entry.kind === "plain") {
                (entry.codec as ISchema<unknown>).write(output, v[entry.key]);
            } else {
                let word = 0;
                for (const p of entry.parts) {
                    const mask = bitMask(p.bitWidth);
                    const part = (v[p.key] as number) & mask;
                    word |= part << p.bitOffset;
                }
                // JS bit-OR/shift returns int32; without `>>> 0`, a part landing
                // on bit 31 produces a negative value the u32 codec rejects.
                entry.codec.write(output, word >>> 0);
            }
        }
    }

    measure(_: unknown | MaxValue, measurer?: IMeasurer): IMeasurer {
        return (measurer ?? new Measurer()).add(this.maxSize);
    }
}

// `1 << 32` is undefined in JS; treat full-codec-width as a special case.
function bitMask(width: number): number {
    return width >= 32 ? 0xffff_ffff : (1 << width) - 1;
}

function buildWireLayout<S extends Record<string, FieldSpec>>(spec: S): WireEntry[] {
    const keys = Object.keys(spec);
    const entries: WireEntry[] = [];
    let i = 0;
    while (i < keys.length) {
        const key = keys[i]!;
        const fs = spec[key]!;

        if (isArraySpec(fs)) {
            if (typeof fs.count !== "number") {
                throw new TypeError("lengthFrom arrays are not supported in raw schema derivation; use the walker.");
            }
            entries.push({
                kind: "plain",
                key,
                codec: arrayOf(fs.element.codec, fs.count) as unknown as AnySchema,
                bytes: fs.count * codecByteLength(fs.element.codec),
            });
            i++;
            continue;
        }

        if (fs.packedAs === undefined) {
            entries.push({
                kind: "plain",
                key,
                codec: fs.codec as unknown as AnySchema,
                bytes: codecByteLength(fs.codec),
            });
            i++;
            continue;
        }

        const slot = fs.packedAs;
        const wireCodec = fs.codec;
        const wireBytes = codecByteLength(wireCodec);
        const wireBits = wireBytes * 8;
        const parts: PackedPart[] = [];
        let j = i;
        while (j < keys.length) {
            const k = keys[j]!;
            const f = spec[k]!;
            if (isArraySpec(f) || f.packedAs !== slot) break;
            if (f.codec !== wireCodec) {
                throw new Error(
                    `packed-field group "${slot}": part "${k}" codec does not match the group's wire codec.`,
                );
            }
            if (!f.bitRange) {
                throw new Error(`packed-field group "${slot}": part "${k}" is missing bitRange.`);
            }
            const [offset, width] = f.bitRange;
            if (!Number.isInteger(offset) || !Number.isInteger(width) || offset < 0 || width <= 0) {
                throw new Error(
                    `packed-field group "${slot}": part "${k}" has invalid bitRange [${offset}, ${width}].`,
                );
            }
            if (offset + width > wireBits) {
                throw new Error(
                    `packed-field group "${slot}": part "${k}" bitRange [${offset}, ${width}] exceeds ${wireBits}-bit wire codec.`,
                );
            }
            parts.push({ key: k, bitOffset: offset, bitWidth: width });
            j++;
        }
        if (parts.length < 2) {
            throw new Error(
                `packed-field group "${slot}" must have at least two consecutive parts; found ${parts.length}.`,
            );
        }
        const sorted = [...parts].sort((a, b) => a.bitOffset - b.bitOffset);
        for (let p = 1; p < sorted.length; p++) {
            const prev = sorted[p - 1]!;
            const cur = sorted[p]!;
            if (prev.bitOffset + prev.bitWidth > cur.bitOffset) {
                throw new Error(`packed-field group "${slot}": parts "${prev.key}" and "${cur.key}" overlap.`);
            }
        }
        entries.push({ kind: "packed", slot, codec: wireCodec, bytes: wireBytes, parts });
        i = j;
    }
    return entries;
}
