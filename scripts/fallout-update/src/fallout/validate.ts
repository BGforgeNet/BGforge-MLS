/**
 * Runtime validation for YAML-parsed sfall data.
 * Each validator takes unknown input and returns a typed value or throws
 * a descriptive error. Used at every YAML.parse() boundary.
 *
 * Shared helpers (assertObject, assertArray, etc.) are in utils/validate-helpers.
 * This file contains Fallout-specific validators.
 */

import {
    assertArray,
    assertObject,
    optionalBoolean,
    optionalString,
    requireString,
    validateArray,
} from "../../../utils/src/validate-helpers.ts";
import type { FalloutArg, SfallCategory, SfallFunction, SfallHook } from "./types.ts";

export { assertArray, assertObject, optionalBoolean, optionalString, requireString, validateArray };

/**
 * Returns a field as string or number if present, undefined otherwise. Throws if present but wrong type.
 */
function optionalStringOrNumber(
    record: Record<string, unknown>,
    field: string,
    context: string,
): string | number | undefined {
    const value = record[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" && typeof value !== "number") {
        throw new TypeError(`Invalid '${field}' (expected string or number) in ${context}`);
    }
    return value;
}

function validateFalloutArg(data: unknown, context: string): FalloutArg {
    const r = assertObject(data, context);
    return {
        name: requireString(r, "name", context),
        type: requireString(r, "type", context),
        doc: requireString(r, "doc", context),
    };
}

export function validateSfallFunction(data: unknown, context: string): SfallFunction {
    const r = assertObject(data, context);

    const rawArgs = r["args"];
    let args: readonly FalloutArg[] | undefined;
    if (rawArgs !== undefined) {
        const arr = assertArray(rawArgs, `${context}.args`);
        args = arr.map((a, i) => validateFalloutArg(a, `${context}.args[${i}]`));
    }

    return {
        name: requireString(r, "name", context),
        detail: requireString(r, "detail", context),
        doc: optionalString(r, "doc", context),
        opcode: optionalStringOrNumber(r, "opcode", context),
        unsafe: optionalBoolean(r, "unsafe", context),
        macro: optionalString(r, "macro", context),
        args,
        type: optionalString(r, "type", context),
    };
}

export function validateSfallCategory(data: unknown, context: string): SfallCategory {
    const r = assertObject(data, context);

    const rawItems = r["items"];
    let items: readonly SfallFunction[] | undefined;
    if (rawItems !== undefined) {
        const arr = assertArray(rawItems, `${context}.items`);
        items = arr.map((item, i) => validateSfallFunction(item, `${context}.items[${i}]`));
    }

    return {
        name: requireString(r, "name", context),
        parent: optionalString(r, "parent", context),
        doc: optionalString(r, "doc", context),
        items,
    };
}

export function validateSfallHook(data: unknown, context: string): SfallHook {
    const r = assertObject(data, context);
    return {
        name: requireString(r, "name", context),
        id: optionalString(r, "id", context),
        doc: requireString(r, "doc", context),
        filename: optionalString(r, "filename", context),
    };
}
