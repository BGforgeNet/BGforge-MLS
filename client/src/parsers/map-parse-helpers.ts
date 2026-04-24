/**
 * Constants and low-level field helpers shared by map parsing phases.
 */

import type { ParsedField, ParsedFieldType, ParsedGroup } from "./types";
import { HEADER_SIZE } from "./map-schemas";

export const MAP_OBJECT_BASE_SIZE = 0x48;
export const MAP_OBJECT_DATA_HEADER_SIZE = 0x0c;
export const STRICT_MAP_SCRIPT_TYPE_COUNT = 4;
export const PID_TYPE_ITEM = 0;
export const PID_TYPE_CRITTER = 1;
export const PID_TYPE_SCENERY = 2;
export const PID_TYPE_MISC = 5;
const FIRST_EXIT_GRID_PID = 0x5_00_00_10;
const LAST_EXIT_GRID_PID = 0x5_00_00_17;
export const HEADER_PADDING_OFFSET = 0x3c;
export const HEADER_PADDING_SIZE = 176;
export const HEADER_OPAQUE_END = HEADER_SIZE;

export function field(
    name: string,
    value: unknown,
    offset: number,
    size: number,
    type: ParsedFieldType,
    description?: string,
    rawValue?: number,
): ParsedField {
    return { name, value, offset, size, type, description, rawValue };
}

export function makeGroup(
    name: string,
    fields: (ParsedField | ParsedGroup)[],
    expanded = true,
    description?: string,
): ParsedGroup {
    return { name, fields, expanded, description };
}

export function flagsField(
    name: string,
    value: number,
    flagDefs: Record<number, string>,
    offset: number,
    size: number,
): ParsedField {
    const flags: string[] = [];
    for (const [bit, flagName] of Object.entries(flagDefs)) {
        const bitVal = Number(bit);
        if (bitVal === 0) {
            if (value === 0) flags.push(flagName);
        } else if (value & bitVal) {
            flags.push(flagName);
        }
    }
    const display = flags.length > 0 ? flags.join(", ") : "(none)";
    return field(name, display, offset, size, "flags", undefined, value);
}

export function enumField(
    name: string,
    value: number,
    lookup: Record<number, string>,
    offset: number,
    size: number,
    errors?: string[],
): ParsedField {
    const resolved = lookup[value];
    if (resolved === undefined && errors) {
        errors.push(`Invalid ${name} at offset 0x${offset.toString(16)}: ${value}`);
    }
    return field(name, resolved ?? `Unknown (${value})`, offset, size, "enum", undefined, value);
}

export function int32Field(name: string, data: Uint8Array, offset: number): ParsedField {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return field(name, view.getInt32(0, false), offset, 4, "int32");
}

export function uint32Field(name: string, data: Uint8Array, offset: number): ParsedField {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return field(name, view.getUint32(0, false), offset, 4, "uint32");
}

export function noteField(name: string, value: string, offset: number): ParsedField {
    return field(name, value, offset, 0, "note");
}

export function isExitGridPid(pid: number): boolean {
    return pid >= FIRST_EXIT_GRID_PID && pid <= LAST_EXIT_GRID_PID;
}

export function objectTypeName(pid: number): string {
    switch ((pid >>> 24) & 0xff) {
        case PID_TYPE_ITEM:
            return "Item";
        case PID_TYPE_CRITTER:
            return "Critter";
        case PID_TYPE_SCENERY:
            return "Scenery";
        case 3:
            return "Wall";
        case 4:
            return "Tile";
        case PID_TYPE_MISC:
            return "Misc";
        default:
            return `Type${(pid >>> 24) & 0xff}`;
    }
}

export function fieldNumber(objectGroup: ParsedGroup, name: string): number | undefined {
    const found = objectGroup.fields.find((entry) => !("fields" in entry) && entry.name === name);
    if (!found || "fields" in found) {
        return undefined;
    }

    if (typeof found.rawValue === "number") {
        return found.rawValue;
    }

    return typeof found.value === "number" ? found.value : undefined;
}
