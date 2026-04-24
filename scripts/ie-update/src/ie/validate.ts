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
    validateArray,
} from "../../../utils/src/validate-helpers.ts";
import type {
    ActionItem,
    ActionParam,
    FuncData,
    FuncParam,
    FuncReturn,
    IESDPGame,
    ItemTypeRaw,
    OffsetItem,
    TypeEntry,
} from "./types.ts";

export { assertArray, assertObject, optionalBoolean, optionalString, requireString, validateArray };

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

export function validateItemTypeRaw(data: unknown, context: string): ItemTypeRaw {
    const r = assertObject(data, context);
    return {
        type: requireString(r, "type", context),
        code: requireString(r, "code", context),
        id: optionalString(r, "id", context),
    };
}

export function validateTypeEntry(data: unknown, context: string): TypeEntry {
    const r = assertObject(data, context);
    return {
        name: requireString(r, "name", context),
    };
}

function validateFuncParam(data: unknown, context: string): FuncParam {
    const r = assertObject(data, context);
    const rawDefault = r["default"];
    let defaultVal: string | number | undefined;
    if (rawDefault !== undefined) {
        if (typeof rawDefault !== "string" && typeof rawDefault !== "number") {
            throw new TypeError(`Invalid 'default' (expected string or number) in ${context}`);
        }
        defaultVal = rawDefault;
    }
    return {
        name: requireString(r, "name", context),
        desc: requireString(r, "desc", context),
        type: requireString(r, "type", context),
        required: optionalNumber(r, "required", context),
        default: defaultVal,
    };
}

function validateFuncReturn(data: unknown, context: string): FuncReturn {
    const r = assertObject(data, context);
    return {
        name: requireString(r, "name", context),
        desc: requireString(r, "desc", context),
        type: requireString(r, "type", context),
    };
}

export function validateFuncData(data: unknown, context: string): FuncData {
    const r = assertObject(data, context);

    const rawIntParams = r["int_params"];
    let intParams: readonly FuncParam[] | undefined;
    if (rawIntParams !== undefined) {
        const arr = assertArray(rawIntParams, `${context}.int_params`);
        intParams = arr.map((p, i) => validateFuncParam(p, `${context}.int_params[${i}]`));
    }

    const rawStrParams = r["string_params"];
    let strParams: readonly FuncParam[] | undefined;
    if (rawStrParams !== undefined) {
        const arr = assertArray(rawStrParams, `${context}.string_params`);
        strParams = arr.map((p, i) => validateFuncParam(p, `${context}.string_params[${i}]`));
    }

    const rawReturn = r["return"];
    let ret: readonly FuncReturn[] | undefined;
    if (rawReturn !== undefined) {
        const arr = assertArray(rawReturn, `${context}.return`);
        ret = arr.map((p, i) => validateFuncReturn(p, `${context}.return[${i}]`));
    }

    const rawDefaults = r["defaults"];
    let defaults: Record<string, string> | undefined;
    if (rawDefaults !== undefined) {
        const dr = assertObject(rawDefaults, `${context}.defaults`);
        const entries = Object.entries(dr).map(([key, value]) => {
            if (typeof value !== "string") {
                throw new TypeError(`Invalid default '${key}' (expected string) in ${context}.defaults`);
            }
            return [key, value] as const;
        });
        defaults = Object.fromEntries(entries);
    }

    return {
        name: requireString(r, "name", context),
        type: requireString(r, "type", context),
        desc: requireString(r, "desc", context),
        int_params: intParams,
        string_params: strParams,
        return: ret,
        defaults,
    };
}
