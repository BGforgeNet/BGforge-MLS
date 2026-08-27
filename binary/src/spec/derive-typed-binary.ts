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
import { flagArrayToInt, intToFlagArray, type FlagArray } from "./coded-projection";
import {
    isArraySpec,
    isCharsSpec,
    isFromCtxCount,
    isFromFieldCount,
    type FieldSpec,
    type ScalarFieldSpec,
    type SpecData,
} from "./types";

/**
 * Read N raw bytes verbatim into a JS string, one Latin-1 char per byte
 * (including NULs). Lossless: any 8-bit byte value round-trips through the
 * string. The display layer strips trailing NULs for human-readable output;
 * the canonical JSON snapshot encodes embedded NULs as `\u0000` so the
 * full byte content is preserved for diff and reload.
 *
 * Why not "trim NULs on read, NUL-pad on write": round-trip then breaks for
 * fields whose stored bytes carry data past the first NUL - common in
 * IESDP-marked `unused` resref slots that ship with non-zero filler bytes.
 * Preserve-all is byte-perfect; cosmetic NUL-stripping happens at display.
 */
/**
 * Wrap a numeric wire codec to project a flag word as a sorted-array
 * `{flags, flagsRaw?}` projection at the canonical-doc layer. Read converts
 * the int to `{flags: string[], flagsRaw?: string}`; write converts the
 * projection back to the int and delegates to the inner codec.
 *
 * Co-locates the named-projection-aware boundary with the wire codec so any
 * spec entry carrying a `flags` table gets the array shape automatically -
 * no per-format reader/writer code needs to handle the translation.
 */
class FlagArraySchema extends Schema<FlagArray> {
    readonly maxSize: number;
    private readonly inner: ISchema<number>;
    private readonly table: Readonly<Record<number, string>>;
    private readonly codecBitWidth: number;
    constructor(fs: ScalarFieldSpec) {
        super();
        if (!fs.flags) {
            throw new TypeError("FlagArraySchema requires a `flags` annotation on the spec entry");
        }
        this.inner = fs.codec;
        this.table = fs.flags;
        this.codecBitWidth = codecByteLength(fs.codec) * 8;
        this.maxSize = codecByteLength(fs.codec);
    }
    read(input: ISerialInput): FlagArray {
        const value = this.inner.read(input);
        return intToFlagArray(this.table, value, this.codecBitWidth);
    }
    write(output: ISerialOutput, value: FlagArray): void {
        const packed = flagArrayToInt(this.table, value, this.codecBitWidth);
        this.inner.write(output, packed);
    }
    measure(_value: FlagArray | MaxValue, measurer?: IMeasurer): IMeasurer {
        return (measurer ?? new Measurer()).add(this.maxSize);
    }
}

class CharsSchema extends Schema<string> {
    readonly maxSize: number;
    readonly count: number;
    constructor(count: number) {
        super();
        this.count = count;
        this.maxSize = count;
    }
    read(input: ISerialInput): string {
        const bytes: number[] = [];
        for (let i = 0; i < this.count; i++) {
            bytes.push(input.readByte());
        }
        return String.fromCodePoint(...bytes);
    }
    write(output: ISerialOutput, value: string): void {
        // The string carries the byte content one char per byte. Truncate to
        // N or NUL-pad to N for shorter values (user-edited or NUL-trimmed
        // strings). Each char must encode in one byte (codes 0-255).
        const limit = Math.min(value.length, this.count);
        for (let i = 0; i < limit; i++) {
            const code = value.codePointAt(i)!;
            if (code > 0xff) {
                throw new RangeError(`Chars value contains non-Latin-1 char code 0x${code.toString(16)} at index ${i}`);
            }
            output.writeByte(code);
        }
        for (let i = limit; i < this.count; i++) {
            output.writeByte(0);
        }
    }
    measure(_value: string | MaxValue, measurer?: IMeasurer): IMeasurer {
        return (measurer ?? new Measurer()).add(this.count);
    }
}

/**
 * Codec interface returned by `toTypedBinarySchema`. Mirrors the read/write
 * shape of typed-binary's `ISchema<Doc>` but does NOT extend it - typed-binary
 * folds `ISchema<T>` through a `Parsed<T, Ctx>` simplification on
 * `write(_, value)` that defeats subtype refinement when a custom `ctx`
 * argument is added. Standalone definition keeps the public API simple
 * (`read(view, ctx?)` / `write(view, doc, ctx?)`) without that wrinkle.
 *
 * `ctx` is consumed by specs that declare `count: { fromCtx: (ctx) => N }`
 * for cross-struct length resolution. Specs without cross-struct deps
 * default `Ctx` to `void` and ignore the argument.
 */
export interface SpecCodec<Doc, Ctx = void> {
    readonly maxSize: number;
    read(input: ISerialInput, ctx?: Ctx): Doc;
    write(output: ISerialOutput, value: Doc, ctx?: Ctx): void;
    measure(value: Doc | MaxValue, measurer?: IMeasurer, ctx?: Ctx): IMeasurer;
}

/**
 * Derive a typed-binary schema from a `StructSpec`.
 *
 * For pure-scalar specs with fixed-count arrays only, returns a typed-binary
 * `object({...})` schema (one prop per spec key) wrapped in a `SpecCodec`
 * adapter that ignores any unused ctx argument. When the spec needs
 * cross-field coordination - bit-packed slots (`packedAs`), same-struct
 * length-from-field arrays (`count: { fromField }`), or cross-struct
 * ctx-bound arrays (`count: { fromCtx }`) - falls through to a custom
 * `SpecStructSchema` that walks the spec in declaration order and handles
 * those interactions directly.
 *
 * Results are cached by spec reference so repeated derivations on the same
 * spec object return the same schema instance.
 */
const cache = new WeakMap<object, SpecCodec<unknown, unknown>>();

export function toTypedBinarySchema<S extends Record<string, FieldSpec>, Ctx = void>(
    spec: S,
): SpecCodec<SpecData<S>, Ctx> {
    const cached = cache.get(spec);
    if (cached) return cached as SpecCodec<SpecData<S>, Ctx>;

    const needsCustom = Object.values(spec).some((f) => {
        if (isArraySpec(f)) return typeof f.count !== "number";
        if (isCharsSpec(f)) return false;
        return f.packedAs !== undefined;
    });

    let schema: SpecCodec<unknown, unknown>;
    if (needsCustom) {
        schema = new SpecStructSchema(spec);
    } else {
        const props: Record<string, AnySchema> = {};
        for (const key of Object.keys(spec)) {
            props[key] = fieldSpecToCodec(spec[key]!);
        }
        schema = adaptObject(object(props) as unknown as ISchema<unknown>);
    }
    cache.set(spec, schema);
    return schema as SpecCodec<SpecData<S>, Ctx>;
}

// Pure-scalar specs cannot need ctx by construction (no fromCtx variant
// reaches this branch - that's gated by `needsCustom`). The adapter exists
// to align the return type; the `ctx` argument is intentionally ignored.
//
// Internal interface: typed-binary's public `ISchema<T>.read/write/measure`
// types are folded through a `Parsed<T, Ctx>` simplification that doesn't
// reduce to `T` for free-form generics. The cast-narrowed shape below is
// what the runtime actually exposes; the cast is local and well-isolated.
interface SimpleSchema<T> {
    readonly maxSize?: number;
    read(input: ISerialInput): T;
    write(output: ISerialOutput, value: T): void;
    measure(value: T | MaxValue, measurer?: IMeasurer): IMeasurer;
}

function adaptObject<T>(inner: ISchema<T>): SpecCodec<T> {
    const s = inner as unknown as SimpleSchema<T>;
    return {
        get maxSize() {
            return s.maxSize ?? 0;
        },
        read(input: ISerialInput): T {
            return s.read(input);
        },
        write(output: ISerialOutput, value: T): void {
            s.write(output, value);
        },
        measure(value: T | MaxValue, measurer?: IMeasurer): IMeasurer {
            return s.measure(value, measurer);
        },
    };
}

function fieldSpecToCodec(fs: FieldSpec): AnySchema {
    if (isArraySpec(fs)) {
        // Reachable only on the pure-scalar dispatch branch where lengthFrom
        // arrays have already been ruled out; throwing here is a guard against
        // future refactors that bypass the dispatch.
        if (typeof fs.count !== "number") {
            throw new TypeError(
                "Variable-length arrays must be derived via SpecStructSchema, not the object({...}) path.",
            );
        }
        return arrayOf(fs.element.codec, fs.count);
    }
    if (isCharsSpec(fs)) {
        return new CharsSchema(fs.count);
    }
    if (fs.flags) {
        return new FlagArraySchema(fs);
    }
    return fs.codec;
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
          readonly kind: "fromFieldArray";
          readonly key: string;
          readonly elementCodec: ISchema<number>;
          readonly elementBytes: number;
          readonly fromField: string;
      }
    | {
          readonly kind: "fromCtxArray";
          readonly key: string;
          readonly elementCodec: ISchema<number>;
          readonly elementBytes: number;
          readonly fromCtx: (ctx: never) => number;
      };

// Extends `Schema<unknown>` rather than `Schema<SpecData<S>>` to dodge the
// generic-`Parsed<T, Ctx>` simplification mismatch; the call site in
// `toTypedBinarySchema` casts back to `SpecCodec<SpecData<S>, Ctx>` at the
// boundary.
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
        this.maxSize = this.entries.reduce(
            (sum, e) => sum + (e.kind === "fromFieldArray" || e.kind === "fromCtxArray" ? 0 : e.bytes),
            0,
        );
    }

    read(input: ISerialInput, ctx?: unknown): unknown {
        const out: Record<string, unknown> = {};
        for (const entry of this.entries) {
            if (entry.kind === "plain") {
                out[entry.key] = entry.codec.read(input);
            } else if (entry.kind === "packed") {
                const word = entry.codec.read(input);
                for (const p of entry.parts) {
                    const mask = bitMask(p.bitWidth);
                    out[p.key] = (word >>> p.bitOffset) & mask;
                }
            } else {
                // Both array kinds resolve a count; only the source and validation differ.
                // Neither bounds the count against the remaining buffer: the caller owns that
                // (fromCtx counts are pre-clamped upstream, e.g. clampVarCount; fromField counts
                // rely on the format's MAX_FILE_SIZES cap making an oversized read throw). A new
                // format adding a large array here needs an equivalent caller-side bound.
                const count = ((): number => {
                    if (entry.kind === "fromFieldArray") {
                        const c = out[entry.fromField];
                        if (typeof c !== "number") {
                            throw new TypeError(
                                `lengthFrom array "${entry.key}" references field "${entry.fromField}" which has not been read as a number.`,
                            );
                        }
                        return c;
                    }
                    if (ctx === undefined || ctx === null) {
                        throw new TypeError(
                            `fromCtx array "${entry.key}" requires a ctx argument; pass one to spec.read(view, ctx).`,
                        );
                    }
                    const c = (entry.fromCtx as (c: unknown) => number)(ctx);
                    if (typeof c !== "number" || !Number.isFinite(c) || c < 0) {
                        throw new TypeError(
                            `fromCtx array "${entry.key}" produced a non-numeric or negative count (${String(c)}).`,
                        );
                    }
                    return c;
                })();
                out[entry.key] = Array.from({ length: count }, () => entry.elementCodec.read(input));
            }
        }
        return out;
    }

    write(output: ISerialOutput, value: unknown, _ctx?: unknown): void {
        const v = value as Record<string, unknown>;
        for (const entry of this.entries) {
            if (entry.kind === "plain") {
                entry.codec.write(output, v[entry.key]);
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
                // fromFieldArray and fromCtxArray both serialise the doc's
                // array verbatim. The wire count is recovered on read from
                // either the same-struct field (synced via
                // `enforceLinkedCounts` + zod refinement) or the ctx supplied
                // at read time (orchestrator's responsibility).
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
            if (entry.kind !== "fromFieldArray" && entry.kind !== "fromCtxArray") continue;
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

        if (isCharsSpec(fs)) {
            entries.push({
                kind: "plain",
                key,
                codec: new CharsSchema(fs.count) as unknown as AnySchema,
                bytes: fs.count,
            });
            i++;
            continue;
        }

        if (isArraySpec(fs)) {
            if (typeof fs.count === "number") {
                entries.push({
                    kind: "plain",
                    key,
                    codec: arrayOf(fs.element.codec, fs.count) as unknown as AnySchema,
                    bytes: fs.count * codecByteLength(fs.element.codec),
                });
            } else if (isFromFieldCount(fs.count)) {
                entries.push({
                    kind: "fromFieldArray",
                    key,
                    elementCodec: fs.element.codec,
                    elementBytes: codecByteLength(fs.element.codec),
                    fromField: fs.count.fromField,
                });
            } else if (isFromCtxCount(fs.count)) {
                entries.push({
                    kind: "fromCtxArray",
                    key,
                    elementCodec: fs.element.codec,
                    elementBytes: codecByteLength(fs.element.codec),
                    fromCtx: fs.count.fromCtx,
                });
            }
            i++;
            continue;
        }

        if (fs.packedAs === undefined) {
            const codec: AnySchema = fs.flags ? new FlagArraySchema(fs) : fs.codec;
            entries.push({
                kind: "plain",
                key,
                codec,
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
            if (isArraySpec(f) || isCharsSpec(f) || f.packedAs !== slot) break;
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
