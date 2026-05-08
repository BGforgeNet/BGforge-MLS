import { z } from "zod";
import { zodNumericType } from "../binary-format-contract";
import { codecByteLength, codecNumericTypeName } from "./codec-meta";
import { compileFlagTable } from "./coded-projection";
import { isArraySpec, isCharsSpec, isFromFieldCount, type FieldSpec, type SpecData } from "./types";

/**
 * Validation strictness for `toZodSchema`.
 *
 * - **`"strict"`** (default) — full refinement: codec range, packed bit width,
 *   array length, strictObject keys, plus value-level checks (enum membership,
 *   domain bounds, linked-count consistency). Used by canonical-writers to
 *   gate bytes that are about to be saved.
 * - **`"permissive"`** — structural refinements only; value-level refinements
 *   are dropped. Used by canonical-doc creation from parsed bytes and by
 *   snapshot load, so a file with an out-of-enum or out-of-domain value still
 *   produces a walkable canonical doc. The save path is the strict gate; the
 *   read paths are tolerant.
 */
export interface ToZodSchemaOptions {
    readonly mode?: "strict" | "permissive";
}

/**
 * Derive a zod canonical-document schema from a `StructSpec`.
 *
 * Each scalar field maps to `z.number().int().min(typeMin).max(typeMax)` based
 * on its codec's signedness, narrowed further by `spec.domain` if present (in
 * strict mode). Fixed-count arrays map to `z.array(...).length(N)`.
 * Length-from-field arrays are validated structurally by the reader, not by
 * zod, so they map to a plain `z.array(...)`.
 */
export function toZodSchema<S extends Record<string, FieldSpec>>(
    spec: S,
    options: ToZodSchemaOptions = {},
): z.ZodType<SpecData<S>> {
    const mode = options.mode ?? "strict";
    const shape: Record<string, z.ZodType<unknown>> = {};
    const linkedCounts: { arrayKey: string; countField: string }[] = [];
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        shape[key] = fieldSpecToZod(fs, mode);
        // fromCtx arrays get their count from a value decoded outside this
        // struct; zod cannot validate that cross-struct relation, so the
        // refinement is scoped to same-struct fromField pairs only.
        if (isArraySpec(fs) && isFromFieldCount(fs.count)) {
            linkedCounts.push({ arrayKey: key, countField: fs.count.fromField });
        }
    }
    let schema: z.ZodType<unknown> = z.strictObject(shape);
    if (mode === "strict" && linkedCounts.length > 0) {
        // Save-time guard: each lengthFrom array's length must equal its
        // declared count field. enforceLinkedCounts (in spec/types.ts) is the
        // pre-serialization sync helper; this refinement is the safety net
        // that catches docs assembled without that helper.
        schema = schema.superRefine((doc, ctx) => {
            const d = doc as Record<string, unknown>;
            for (const { arrayKey, countField } of linkedCounts) {
                const arr = d[arrayKey];
                const count = d[countField];
                if (!Array.isArray(arr) || typeof count !== "number") continue;
                if (arr.length !== count) {
                    ctx.addIssue({
                        code: "custom",
                        path: [arrayKey],
                        message: `lengthFrom array "${arrayKey}" has length ${arr.length} but count field "${countField}" is ${count}.`,
                    });
                }
            }
        });
    }
    return schema as unknown as z.ZodType<SpecData<S>>;
}

function fieldSpecToZod(fs: FieldSpec, mode: "strict" | "permissive"): z.ZodType<unknown> {
    if (isArraySpec(fs)) {
        const inner = fieldSpecToZod(fs.element, mode);
        if (typeof fs.count === "number") {
            return z.array(inner).length(fs.count);
        }
        return z.array(inner);
    }
    if (isCharsSpec(fs)) {
        // Fixed-size ASCII string. Cap the JS-string length at the byte budget;
        // shorter values are NUL-padded by the codec.
        return z.string().max(fs.count);
    }
    if (fs.flags) {
        // Flag word: project to a strict-object dict of named-bit booleans
        // plus a `_bits` reservoir that carries unnamed bits as a hex string.
        // The strict-disjoint invariant (named bits never appear in `_bits`)
        // is enforced by `flagDictToInt` at the wire boundary; the schema
        // shape itself just gates the surface — every named key is required,
        // `_bits` is optional, no extra keys allowed.
        return flagDictZodSchema(fs.flags, codecByteLength(fs.codec) * 8);
    }
    if (fs.enum && mode === "strict" && !fs.enumOpen) {
        // Closed enums (PRO `objectType`, ITM ability `attackType`, etc.):
        // saved values must be a key in the enum table; permissive parsing
        // still surfaces "Unknown (N)" in the display tree, but committing a
        // value back to bytes is rejected here so .pro.json snapshots stay
        // round-trippable. Open enums (`enumOpen: true`, e.g. effect opcodes,
        // ITM type) skip this refinement — the table is advisory, not
        // exhaustive.
        //
        // Enums stay numeric in canonical-doc by design: half the enum fields
        // drive dispatch (`objectType`, `subType`, `scriptType`, MAP `version`
        // / `rotation` / `elevation`) and have to convert to int at every
        // dispatch site if projected to strings. The diff-friendliness gain
        // from named projection is also marginal compared to flags — toggling
        // an enum changes one number to another (`5 → 0`) at the same line
        // count as `"Items" → "Background"`. The display layer's `enum` table
        // resolves names for dropdowns and hover; the snapshot stays close to
        // the wire. Helpers `intToEnumValue` / `enumValueToInt` in
        // `coded-projection.ts` are available as opt-in utilities for code
        // that wants to convert.
        const allowed = new Set(Object.keys(fs.enum).map(Number));
        return z
            .number()
            .int()
            .refine((v) => allowed.has(v), {
                message: `expected one of ${[...allowed].join(", ")}`,
            });
    }
    // Packed-field parts: bounds come from bitRange (unsigned bit field),
    // not from the wire codec's full numeric range. The wire codec on a
    // packed part is the SLOT codec (e.g., u32 for a 26-bit subfield) —
    // applying its range would let `destTile = 0x04000000` pass even though
    // it overflows the 26-bit slot. The bit-width bound is structural (the
    // value cannot fit in the wire slot) so it stays in permissive mode too.
    let schema: z.ZodNumber;
    if (fs.packedAs !== undefined && fs.bitRange) {
        const [, width] = fs.bitRange;
        const max = width >= 32 ? 0xffffffff : (1 << width) - 1;
        schema = z.number().int().min(0).max(max);
    } else {
        schema = zodNumericType(codecNumericTypeName(fs.codec));
    }
    if (fs.domain && mode === "strict") {
        schema = schema.min(fs.domain.min).max(fs.domain.max);
    }
    return schema;
}

/**
 * Build the zod schema for an enum-value canonical-doc field.
 *
 * `closedStrict = true` produces a string-only union over the enum's named
 * values (the strict-save gate for closed enums); otherwise the schema is
 * `string | number` (permissive read for closed enums, and the steady-state
 * shape for open enums where the table is advisory).
 *
 * Exported so hand-written canonical schemas (e.g. MAP) can declare enum
 * fields without re-deriving the shape from a spec entry.
 */
export function enumValueZodSchema(
    table: Readonly<Record<number, string>>,
    closedStrict: boolean,
): z.ZodType<string | number> {
    const names = Object.values(table);
    const literalSchemas = names.map((n) => z.literal(n));
    if (literalSchemas.length === 0) {
        // Defensive: an enum table with no entries doesn't constrain
        // anything; fall through to z.number(). Should not occur in practice.
        return z.number().int();
    }
    if (closedStrict) {
        return literalSchemas.length === 1
            ? (literalSchemas[0] as unknown as z.ZodType<string | number>)
            : (z.union(literalSchemas as unknown as [z.ZodType<string>, z.ZodType<string>]) as unknown as z.ZodType<
                  string | number
              >);
    }
    const stringPart =
        literalSchemas.length === 1
            ? (literalSchemas[0] as unknown as z.ZodType<string>)
            : z.union(literalSchemas as unknown as [z.ZodType<string>, z.ZodType<string>]);
    return z.union([stringPart, z.number().int()]) as unknown as z.ZodType<string | number>;
}

/**
 * Build the zod schema for a flag-dict canonical-doc field. Exported so
 * hand-written canonical schemas (e.g. MAP) can declare flag fields without
 * re-deriving the shape from a spec entry. `codecBitWidth` is 8 / 16 / 24 / 32
 * — must match the wire codec's width so `_bits` cannot carry bits outside
 * the wire word.
 */
/**
 * Build the zod schema for a flag-array canonical-doc field. Exported so
 * hand-written canonical schemas (e.g. MAP) can declare flag fields without
 * re-deriving the shape from a spec entry. `codecBitWidth` is 8 / 16 / 24 / 32
 * — must match the wire codec's width so `flagsRaw` cannot carry bits outside
 * the wire word. Sort order is the writer's responsibility (`intToFlagArray`
 * emits alphabetically); the schema enforces uniqueness but accepts any order
 * so a hand-edit doesn't fail validation just for inserting a name in the
 * "wrong" slot.
 */
export function flagArrayZodSchema(
    table: Readonly<Record<number, string>>,
    codecBitWidth: number,
): z.ZodType<{ flags: readonly string[]; flagsRaw?: string }> {
    const codecMaxHexDigits = Math.ceil(codecBitWidth / 4);
    const { entries } = compileFlagTable(table);
    const names = entries.map((entry) => entry.key);
    const flagsItem =
        names.length === 0
            ? z.never()
            : names.length === 1
              ? z.literal(names[0]!)
              : z.enum(names as [string, ...string[]]);
    const flagsArray = z
        .array(flagsItem)
        .refine((arr) => new Set(arr).size === arr.length, { message: "flags array must not contain duplicate names" });
    const reservoirSchema = z
        .string()
        .regex(new RegExp(`^0x[0-9a-fA-F]{1,${codecMaxHexDigits}}$`), {
            message: `flagsRaw must match /^0x[0-9a-fA-F]{1,${codecMaxHexDigits}}$/`,
        })
        .optional();
    return z.strictObject({
        flags: flagsArray,
        flagsRaw: reservoirSchema,
    }) as unknown as z.ZodType<{ flags: readonly string[]; flagsRaw?: string }>;
}

export function flagDictZodSchema(
    table: Readonly<Record<number, string>>,
    codecBitWidth: number,
): z.ZodType<Record<string, boolean | string>> {
    const codecMaxHexDigits = Math.ceil(codecBitWidth / 4);
    const { entries } = compileFlagTable(table);
    const shape: Record<string, z.ZodType<unknown>> = {};
    for (const entry of entries) {
        shape[entry.key] = z.boolean();
    }
    // `_bits` is the reservoir for unnamed bits in the wire word. Width-bound
    // to the codec so a hand-edit cannot smuggle bits beyond the wire shape.
    // Disjointness with named bits is checked by `flagDictToInt` (the
    // wire-boundary validator); enforcing it here too would require wiring
    // the named mask through every refinement, doubled for permissive mode.
    const reservoirSchema = z
        .string()
        .regex(new RegExp(`^0x[0-9a-fA-F]{1,${codecMaxHexDigits}}$`), {
            message: `_bits must match /^0x[0-9a-fA-F]{1,${codecMaxHexDigits}}$/`,
        })
        .optional();
    shape._bits = reservoirSchema;
    return z.strictObject(shape) as unknown as z.ZodType<Record<string, boolean | string>>;
}
