/**
 * Shared runtime validation helpers for YAML-parsed data.
 * Used by both ie-update and fallout-update validate modules
 * to assert types at YAML.parse() boundaries.
 */

/**
 * Validates that a value is a non-null object. Throws with context on failure.
 */
export function assertObject(data: unknown, context: string): Record<string, unknown> {
    if (typeof data !== "object" || data === null) {
        throw new Error(`Expected object in ${context}, got ${data === null ? "null" : typeof data}`);
    }
    return data as Record<string, unknown>;
}

/**
 * Validates that a value is an array. Throws with context on failure.
 */
export function assertArray(data: unknown, context: string): readonly unknown[] {
    if (!Array.isArray(data)) {
        throw new TypeError(`Expected array in ${context}, got ${typeof data}`);
    }
    return data as readonly unknown[];
}

/**
 * Validates that a field is a string. Throws with field name and context on failure.
 */
export function requireString(record: Record<string, unknown>, field: string, context: string): string {
    const value = record[field];
    if (typeof value !== "string") {
        throw new TypeError(`Missing or invalid '${field}' (expected string) in ${context}`);
    }
    return value;
}

/**
 * Returns a field as string if present, undefined otherwise. Throws if present but wrong type.
 */
export function optionalString(record: Record<string, unknown>, field: string, context: string): string | undefined {
    const value = record[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new TypeError(`Invalid '${field}' (expected string) in ${context}`);
    }
    return value;
}

/**
 * Returns a field as boolean if present, undefined otherwise. Throws if present but wrong type.
 */
export function optionalBoolean(record: Record<string, unknown>, field: string, context: string): boolean | undefined {
    const value = record[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "boolean") {
        throw new TypeError(`Invalid '${field}' (expected boolean) in ${context}`);
    }
    return value;
}

/**
 * Validates an array of items using the given item validator.
 * Provides indexed context for each element's error messages.
 */
export function validateArray<T>(
    data: unknown,
    itemValidator: (item: unknown, context: string) => T,
    context: string,
): readonly T[] {
    const arr = assertArray(data, context);
    return arr.map((item, i) => itemValidator(item, `${context}[${i}]`));
}
