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
 * Derive a typed-binary schema from a `StructSpec`.
 *
 * For pure-scalar specs with fixed-count arrays only, returns a typed-binary
 * `object({...})` schema (one prop per spec key). When the spec needs
 * cross-field coordination — bit-packed slots (`packedAs`) or length-from-field
 * arrays (`count: { fromField }`) — falls through to a custom `SpecStructSchema`
 * that walks the spec in declaration order and handles those interactions
 * directly.
 *
 * Results are cached by spec reference so repeated derivations on the same
 * spec object return the same schema instance.
 */
const cache = new WeakMap<object, ISchema<unknown>>();

export function toTypedBinarySchema<S extends Record<string, FieldSpec>>(spec: S): ISchema<SpecData<S>> {
    const cached = cache.get(spec);
    if (cached) return cached as ISchema<SpecData<S>>;

    const needsCustom = Object.values(spec).some((f) => {
        if (isArraySpec(f)) return typeof f.count !== "number";
        return f.packedAs !== undefined;
    });

    let schema: ISchema<unknown>;
    if (needsCustom) {
        schema = new SpecStructSchema(spec);
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
        // Reachable only on the pure-scalar dispatch branch where lengthFrom
        // arrays have already been ruled out; throwing here is a guard against
        // future refactors that bypass the dispatch.
        if (typeof fs.count !== "number") {
            throw new TypeError("lengthFrom arrays must be derived via SpecStructSchema, not the object({...}) path.");
        }
        return arrayOf(fs.element.codec, fs.count) as unknown as AnySchema;
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
      }
    | {
          readonly kind: "lengthFromArray";
          readonly key: string;
          readonly elementCodec: ISchema<number>;
          readonly elementBytes: number;
          readonly fromField: string;
      };

// Extends `Schema<unknown>` rather than `Schema<SpecData<S>>` to dodge the
// generic-`Parsed<T, Ctx>` simplification mismatch; the call site in
// `toTypedBinarySchema` casts back to `ISchema<SpecData<S>>` at the boundary.
class SpecStructSchema extends Schema<unknown> {
    readonly maxSize: number;
    private readonly entries: readonly WireEntry[];

    constructor(spec: Record<string, FieldSpec>) {
        super();
        this.entries = buildWireLayout(spec);
        // For variable-length structs (lengthFrom arrays), maxSize covers
        // only the fixed contributions; the actual size depends on per-doc
        // array lengths and is computed in `measure(value, ...)`. Callers who
        // need an exact size for buffer allocation should use measure.
        this.maxSize = this.entries.reduce((sum, e) => sum + (e.kind === "lengthFromArray" ? 0 : e.bytes), 0);
    }

    read(input: ISerialInput): unknown {
        const out: Record<string, unknown> = {};
        for (const entry of this.entries) {
            if (entry.kind === "plain") {
                out[entry.key] = (entry.codec as ISchema<unknown>).read(input);
            } else if (entry.kind === "packed") {
                const word = entry.codec.read(input);
                for (const p of entry.parts) {
                    const mask = bitMask(p.bitWidth);
                    out[p.key] = (word >>> p.bitOffset) & mask;
                }
            } else {
                const count = out[entry.fromField];
                if (typeof count !== "number") {
                    throw new TypeError(
                        `lengthFrom array "${entry.key}" references field "${entry.fromField}" which has not been read as a number.`,
                    );
                }
                const arr: number[] = Array.from({ length: count }, () => entry.elementCodec.read(input));
                out[entry.key] = arr;
            }
        }
        return out;
    }

    write(output: ISerialOutput, value: unknown): void {
        const v = value as Record<string, unknown>;
        for (const entry of this.entries) {
            if (entry.kind === "plain") {
                (entry.codec as ISchema<unknown>).write(output, v[entry.key]);
            } else if (entry.kind === "packed") {
                let word = 0;
                for (const p of entry.parts) {
                    const mask = bitMask(p.bitWidth);
                    const part = (v[p.key] as number) & mask;
                    word |= part << p.bitOffset;
                }
                // JS bit-OR/shift returns int32; without `>>> 0`, a part landing
                // on bit 31 produces a negative value the u32 codec rejects.
                entry.codec.write(output, word >>> 0);
            } else {
                const arr = v[entry.key];
                if (!Array.isArray(arr)) {
                    throw new TypeError(`lengthFrom array "${entry.key}" expected an array, got ${typeof arr}.`);
                }
                for (const elem of arr) {
                    entry.elementCodec.write(output, elem as number);
                }
            }
        }
    }

    measure(value: unknown | MaxValue, measurer?: IMeasurer): IMeasurer {
        const m = measurer ?? new Measurer();
        let dynamic = 0;
        for (const entry of this.entries) {
            if (entry.kind !== "lengthFromArray") continue;
            // For MaxValue probes (e.g. typed-binary measuring an unbounded
            // schema), report only the fixed parts; consumers needing an
            // exact size for variable structs must pass an actual value.
            if (typeof value === "object" && value !== null) {
                const arr = (value as Record<string, unknown>)[entry.key];
                if (Array.isArray(arr)) dynamic += arr.length * entry.elementBytes;
            }
        }
        return m.add(this.maxSize + dynamic);
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
            if (typeof fs.count === "number") {
                entries.push({
                    kind: "plain",
                    key,
                    codec: arrayOf(fs.element.codec, fs.count) as unknown as AnySchema,
                    bytes: fs.count * codecByteLength(fs.element.codec),
                });
            } else {
                entries.push({
                    kind: "lengthFromArray",
                    key,
                    elementCodec: fs.element.codec,
                    elementBytes: codecByteLength(fs.element.codec),
                    fromField: fs.count.fromField,
                });
            }
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
