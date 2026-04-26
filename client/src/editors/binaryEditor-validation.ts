/**
 * Validation functions for binary editor field values.
 * Returns an error message string if invalid, undefined if valid.
 */

import { validateNumericValue } from "@bgforge/binary";

/**
 * Validate that a numeric value is within the range for its type.
 * Returns an error message if invalid, undefined if valid.
 *
 * Thin wrapper over `validateNumericValue` from `@bgforge/binary`. Kept as the
 * editor-side entry point so that all four validators in this file (numeric,
 * enum, flags, dispatch) sit behind one import surface for the webview bundle,
 * and a future range-narrowing override (e.g., "this field caps at engine
 * limit X regardless of the underlying int type") has a place to land without
 * touching every call site.
 */
export function validateNumericRange(
    value: number,
    type: string,
    context?: { readonly format?: string; readonly fieldKey?: string },
): string | undefined {
    return validateNumericValue(value, type, context);
}

/**
 * Validate that a value is a valid enum member.
 * Returns an error message if invalid, undefined if valid.
 */
export function validateEnum(value: number, lookup: Record<number, string>): string | undefined {
    if (lookup[value] === undefined) {
        const valid = Object.keys(lookup).join(", ");
        return `Invalid value ${value}. Valid: ${valid}`;
    }
    return undefined;
}

/**
 * Validate that only known flag bits are set.
 * Returns an error message if invalid bits are set, undefined if valid.
 */
export function validateFlags(value: number, flagDefs: Record<number, string>): string | undefined {
    // Build a mask of all valid bits (skip 0 key which means "no flags")
    let validMask = 0;
    for (const bit of Object.keys(flagDefs)) {
        const n = Number(bit);
        if (n !== 0) validMask |= n;
    }

    const invalidBits = value & ~validMask;
    if (invalidBits !== 0) {
        return `Invalid flag bits: 0x${invalidBits.toString(16)}`;
    }
    return undefined;
}

export function validateFieldEdit(
    value: number,
    type: string,
    enumLookup?: Record<number, string>,
    flagDefs?: Record<number, string>,
    context?: { readonly format?: string; readonly fieldKey?: string },
): string | undefined {
    if (type === "enum") {
        return enumLookup ? validateEnum(value, enumLookup) : undefined;
    }

    if (type === "flags") {
        return flagDefs ? validateFlags(value, flagDefs) : undefined;
    }

    if (type.includes("int") || type.includes("uint")) {
        return validateNumericRange(value, type, context);
    }

    return undefined;
}
