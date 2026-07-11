/**
 * Runtime validation for YAML-parsed data.
 * Each validator takes unknown input and returns a typed value or throws
 * a descriptive error. Used at every YAML.parse() boundary.
 *
 * Shared helpers (assertObject, assertArray, etc.) are in utils/validate-helpers.
 * This file contains IE-specific validators and type-specific helpers.
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
import type { ActionItem, ActionParam, IESDPGame, OffsetItem } from "./types.ts";

/**
 * Validates that a field is a number. Throws with field name and context on failure.
 */
function requireNumber(record: Record<string, unknown>, field: string, context: string): number {
    const value = record[field];
    if (typeof value !== "number") {
        throw new TypeError(`Missing or invalid '${field}' (expected number) in ${context}`);
    }
    return value;
}

/**
 * Returns a field as number if present, undefined otherwise. Throws if present but wrong type.
 */
function optionalNumber(record: Record<string, unknown>, field: string, context: string): number | undefined {
    const value = record[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "number") {
        throw new TypeError(`Invalid '${field}' (expected number) in ${context}`);
    }
    return value;
}

/**
 * Returns a field as number or boolean if present, undefined otherwise.
 * Throws if present but wrong type. Used for truthy markers (e.g. unused: 1).
 */
function optionalNumberOrBoolean(
    record: Record<string, unknown>,
    field: string,
    context: string,
): number | boolean | undefined {
    const value = record[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "number" && typeof value !== "boolean") {
        throw new TypeError(`Invalid '${field}' (expected number or boolean) in ${context}`);
    }
    return value;
}

// -- Public validators --

export function validateActionParam(data: unknown, context: string): ActionParam {
    const r = assertObject(data, context);
    return {
        type: requireString(r, "type", context),
        name: requireString(r, "name", context),
        ids: optionalString(r, "ids", context),
    };
}

export function validateActionItem(data: unknown, context: string): ActionItem {
    const r = assertObject(data, context);
    const rawAlias = r["alias"];
    let alias: number | boolean | undefined;
    if (rawAlias !== undefined) {
        if (typeof rawAlias !== "number" && typeof rawAlias !== "boolean") {
            throw new TypeError(`Invalid 'alias' (expected number or boolean) in ${context}`);
        }
        alias = rawAlias;
    }

    const rawParams = r["params"];
    let params: readonly ActionParam[] | undefined;
    if (rawParams !== undefined) {
        const paramsArr = assertArray(rawParams, `${context}.params`);
        params = paramsArr.map((p, i) => validateActionParam(p, `${context}.params[${i}]`));
    }

    return {
        n: requireNumber(r, "n", context),
        name: requireString(r, "name", context),
        bg2: optionalNumber(r, "bg2", context),
        bgee: optionalNumber(r, "bgee", context),
        alias,
        desc: optionalString(r, "desc", context),
        params,
        no_result: optionalBoolean(r, "no_result", context),
        unknown: optionalBoolean(r, "unknown", context),
    };
}

export function validateIESDPGame(data: unknown, context: string): IESDPGame {
    const r = assertObject(data, context);
    return {
        name: requireString(r, "name", context),
        ids: requireString(r, "ids", context),
        "2da": requireString(r, "2da", context),
        actions: requireString(r, "actions", context),
    };
}

export function validateOffsetItem(data: unknown, context: string): OffsetItem {
    const r = assertObject(data, context);
    return {
        type: requireString(r, "type", context),
        desc: requireString(r, "desc", context),
        offset: optionalNumber(r, "offset", context),
        length: optionalNumber(r, "length", context),
        mult: optionalNumber(r, "mult", context),
        id: optionalString(r, "id", context),
        unused: optionalNumberOrBoolean(r, "unused", context),
        unknown: optionalNumberOrBoolean(r, "unknown", context),
    };
}
