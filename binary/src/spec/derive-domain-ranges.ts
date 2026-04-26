import { isArraySpec, type StructSpec } from "./types";

interface NumericRange {
    readonly min: number;
    readonly max: number;
}

/**
 * Derive `DOMAIN_RANGES` entries from a `StructSpec`. Returns one entry per
 * scalar field that declares a `domain`, keyed by `${prefix}.${fieldName}`.
 * Array fields are skipped (their elements are constrained by the codec range
 * already; per-array-element domain support can be added when needed).
 */
export function toDomainRanges<T>(spec: StructSpec<T>, prefix: string): Record<string, NumericRange> {
    const out: Record<string, NumericRange> = {};
    for (const key of Object.keys(spec) as (keyof T & string)[]) {
        const fs = spec[key];
        if (isArraySpec(fs)) continue;
        if (fs.domain) {
            out[`${prefix}.${key}`] = fs.domain;
        }
    }
    return out;
}
