import { z } from "zod";
import { zodNumericType } from "../binary-format-contract";
import { codecNumericTypeName } from "./codec-meta";
import { isArraySpec, type FieldSpec, type StructSpec } from "./types";

/**
 * Derive a zod canonical-document schema from a `StructSpec`.
 *
 * Each scalar field maps to `z.number().int().min(typeMin).max(typeMax)` based
 * on its codec's signedness, narrowed further by `spec.domain` if present.
 * Fixed-count arrays map to `z.array(...).length(N)`. Length-from-field arrays
 * are validated structurally by the reader, not by zod, so they map to a
 * plain `z.array(...)`.
 */
export function toZodSchema<T>(spec: StructSpec<T>): z.ZodType<T> {
    const shape: Record<string, z.ZodType<unknown>> = {};
    for (const key of Object.keys(spec) as (keyof T & string)[]) {
        shape[key] = fieldSpecToZod(spec[key]);
    }
    return z.strictObject(shape) as unknown as z.ZodType<T>;
}

function fieldSpecToZod(fs: FieldSpec): z.ZodType<unknown> {
    if (isArraySpec(fs)) {
        const inner = fieldSpecToZod(fs.element);
        if (typeof fs.count === "number") {
            return z.array(inner).length(fs.count);
        }
        return z.array(inner);
    }
    let schema = zodNumericType(codecNumericTypeName(fs.codec));
    if (fs.domain) {
        schema = schema.min(fs.domain.min).max(fs.domain.max);
    }
    return schema;
}
