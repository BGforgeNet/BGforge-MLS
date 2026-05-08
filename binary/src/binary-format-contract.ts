/**
 * Codec-numeric primitives, plus the per-field domain-range and value
 * validation helpers. Intentionally has no module-load dependency on the
 * format-adapter registry - `format-adapter.ts` injects its registry-driven
 * domain-range lookup via `setDomainRangeLookup` after registering each
 * format's adapter. This lets `derive-zod` and per-format canonical schemas
 * import primitives from this file freely without creating a load-time cycle
 * back through the format adapters.
 */

import { z } from "zod";

type NumericTypeName = "uint8" | "uint16" | "uint24" | "uint32" | "int8" | "int16" | "int24" | "int32";

export interface NumericRange {
    readonly min: number;
    readonly max: number;
}

const NUMERIC_TYPE_RANGES: Record<NumericTypeName, NumericRange> = {
    uint8: { min: 0, max: 0xff },
    uint16: { min: 0, max: 0xffff },
    uint24: { min: 0, max: 0xffffff },
    uint32: { min: 0, max: 0xffffffff },
    int8: { min: -128, max: 127 },
    int16: { min: -32768, max: 32767 },
    int24: { min: -8388608, max: 8388607 },
    int32: { min: -2147483648, max: 2147483647 },
};

export function getNumericTypeRange(type: string): NumericRange | undefined {
    return NUMERIC_TYPE_RANGES[type as NumericTypeName];
}

export function zodNumericType(type: NumericTypeName): z.ZodNumber {
    const range = NUMERIC_TYPE_RANGES[type];
    return z.number().int().min(range.min).max(range.max);
}

// -- Domain-range lookup hook ---------------------------------------------
//
// Setter installed by `format-adapter.ts` after the format adapters
// register. Default no-op lookup keeps `validateNumericValue` /
// `clampNumericValue` correct when called before adapters load (returns
// undefined -> no domain narrowing applies).

type DomainRangeLookup = (format: string, fieldKey: string) => NumericRange | undefined;
let domainRangeLookup: DomainRangeLookup = () => undefined;

/** Installed by `format-adapter.ts` after format adapters register. */
export function setDomainRangeLookup(lookup: DomainRangeLookup): void {
    domainRangeLookup = lookup;
}

export function getDomainRange(format: string, fieldKey: string): NumericRange | undefined {
    return domainRangeLookup(format, fieldKey);
}

export function validateNumericValue(
    value: number,
    type: string,
    context?: {
        readonly format?: string;
        readonly fieldKey?: string;
    },
): string | undefined {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return `Value must be an integer, got ${value}`;
    }

    const typeRange = getNumericTypeRange(type);
    if (typeRange && (value < typeRange.min || value > typeRange.max)) {
        return `Value ${value} out of range for ${type} (${typeRange.min} to ${typeRange.max})`;
    }

    const format = context?.format;
    const fieldKey = context?.fieldKey;
    if (format && fieldKey) {
        const domainRange = getDomainRange(format, fieldKey);
        if (domainRange && (value < domainRange.min || value > domainRange.max)) {
            return `Value ${value} out of allowed range for ${fieldKey} (${domainRange.min} to ${domainRange.max})`;
        }
    }

    return undefined;
}

export function clampNumericValue(
    value: number,
    type: string,
    context?: {
        readonly format?: string;
        readonly fieldKey?: string;
    },
): number {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return value;
    }

    let min = -Infinity;
    let max = Infinity;

    const typeRange = getNumericTypeRange(type);
    if (typeRange) {
        min = Math.max(min, typeRange.min);
        max = Math.min(max, typeRange.max);
    }

    const format = context?.format;
    const fieldKey = context?.fieldKey;
    if (format && fieldKey) {
        const domainRange = getDomainRange(format, fieldKey);
        if (domainRange) {
            min = Math.max(min, domainRange.min);
            max = Math.min(max, domainRange.max);
        }
    }

    return Math.min(Math.max(value, min), max);
}

export function zodFieldNumber(format: string, fieldKey: string, type: NumericTypeName): z.ZodNumber {
    const schema = zodNumericType(type);
    const range = getDomainRange(format, fieldKey);
    return range ? schema.min(range.min).max(range.max) : schema;
}
