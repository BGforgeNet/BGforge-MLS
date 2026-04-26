import { z } from "zod";
import { zodNumericType } from "../binary-format-contract";
import { codecNumericTypeName } from "./codec-meta";
import { isArraySpec, isFromFieldCount, type FieldSpec, type SpecData } from "./types";

/**
 * Derive a zod canonical-document schema from a `StructSpec`.
 *
 * Each scalar field maps to `z.number().int().min(typeMin).max(typeMax)` based
 * on its codec's signedness, narrowed further by `spec.domain` if present.
 * Fixed-count arrays map to `z.array(...).length(N)`. Length-from-field arrays
 * are validated structurally by the reader, not by zod, so they map to a
 * plain `z.array(...)`.
 */
export function toZodSchema<S extends Record<string, FieldSpec>>(spec: S): z.ZodType<SpecData<S>> {
    const shape: Record<string, z.ZodType<unknown>> = {};
    const linkedCounts: { arrayKey: string; countField: string }[] = [];
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        shape[key] = fieldSpecToZod(fs);
        // fromCtx arrays get their count from a value decoded outside this
        // struct; zod cannot validate that cross-struct relation, so the
        // refinement is scoped to same-struct fromField pairs only.
        if (isArraySpec(fs) && isFromFieldCount(fs.count)) {
            linkedCounts.push({ arrayKey: key, countField: fs.count.fromField });
        }
    }
    let schema: z.ZodType<unknown> = z.strictObject(shape);
    if (linkedCounts.length > 0) {
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

function fieldSpecToZod(fs: FieldSpec): z.ZodType<unknown> {
    if (isArraySpec(fs)) {
        const inner = fieldSpecToZod(fs.element);
        if (typeof fs.count === "number") {
            return z.array(inner).length(fs.count);
        }
        return z.array(inner);
    }
    if (fs.enum) {
        // Saved values must be a key in the enum table; permissive parsing
        // still surfaces "Unknown (N)" in the display tree, but committing a
        // value back to bytes is rejected here so .pro.json snapshots stay
        // round-trippable.
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
    // applying its range would let `destTile = 0x0400_0000` pass even though
    // it overflows the 26-bit slot.
    let schema: z.ZodNumber;
    if (fs.packedAs !== undefined && fs.bitRange) {
        const [, width] = fs.bitRange;
        const max = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
        schema = z.number().int().min(0).max(max);
    } else {
        schema = zodNumericType(codecNumericTypeName(fs.codec));
    }
    if (fs.domain) {
        schema = schema.min(fs.domain.min).max(fs.domain.max);
    }
    return schema;
}
