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
} from "../../../utils/src/validate-helpers.ts";
export {
    assertArray,
    assertObject,
    optionalBoolean,
    optionalString,
    requireString,
    validateArray,
} from "../../../utils/src/validate-helpers.ts";
import type { SfallArg, SfallCategory, SfallFunction, SfallHook } from "./types.ts";

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

function validateSfallArg(data: unknown, context: string): SfallArg {
    const r = assertObject(data, context);
    // YAML reads an unquoted `0` as a number; the signature prints it either way.
    const value = optionalStringOrNumber(r, "default", context);
    return {
        name: requireString(r, "name", context),
        type: requireString(r, "type", context),
        doc: optionalString(r, "doc", context),
        optional: optionalBoolean(r, "optional", context),
        default: value === undefined ? undefined : String(value),
    };
}

function optionalDeprecation(record: Record<string, unknown>, context: string): boolean | string | undefined {
    const value = record["deprecated"];
    if (value === undefined || typeof value === "boolean" || typeof value === "string") return value;
    throw new TypeError(`Invalid 'deprecated' (expected true, false or a message) in ${context}`);
}

export function validateSfallFunction(data: unknown, context: string): SfallFunction {
    const r = assertObject(data, context);

    const rawArgs = r["args"];
    let args: readonly SfallArg[] | undefined;
    if (rawArgs !== undefined) {
        const arr = assertArray(rawArgs, `${context}.args`);
        args = arr.map((a, i) => validateSfallArg(a, `${context}.args[${i}]`));
    }

    const detail = optionalString(r, "detail", context);
    const type = optionalString(r, "type", context);
    if (detail === undefined && type === undefined) {
        throw new TypeError(`Missing 'type' in ${context}: a function without 'detail' needs its return type`);
    }
    const metarule = optionalString(r, "metarule", context);
    const omittable = metarule === undefined ? args?.find((a) => a.optional === true) : undefined;
    if (omittable !== undefined) {
        throw new TypeError(
            `'optional' on argument '${omittable.name}' in ${context}: only a metarule call can omit an argument`,
        );
    }

    return {
        name: requireString(r, "name", context),
        detail,
        doc: optionalString(r, "doc", context),
        opcode: optionalStringOrNumber(r, "opcode", context),
        unsafe: optionalBoolean(r, "unsafe", context),
        macro: optionalString(r, "macro", context),
        metarule,
        args,
        type,
        deprecated: optionalDeprecation(r, context),
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
