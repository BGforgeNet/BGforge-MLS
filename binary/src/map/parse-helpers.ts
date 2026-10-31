/**
 * Constants and low-level field helpers shared by map parsing phases.
 */

import type { ParsedField, ParsedFieldType, ParsedGroup } from "../types";
import { stringifyKeys } from "../presentation-schema-types";
import { fieldLabel, type StructPresentation } from "../spec/presentation";
import { mapGroupLabels } from "./specs/sections";
export { HEADER_SIZE as HEADER_OPAQUE_END } from "./schemas";
export const MAP_OBJECT_BASE_SIZE = 0x48;
export const MAP_OBJECT_DATA_HEADER_SIZE = 0x0c;
export const STRICT_MAP_SCRIPT_TYPE_COUNT = 4;
export const PID_TYPE_ITEM = 0;
export const PID_TYPE_CRITTER = 1;
export const PID_TYPE_SCENERY = 2;
export const PID_TYPE_MISC = 5;
const FIRST_EXIT_GRID_PID = 0x5000010;
const LAST_EXIT_GRID_PID = 0x5000017;
export const HEADER_PADDING_OFFSET = 0x3c;
export const HEADER_PADDING_SIZE = 176;

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

export function int32Field(name: string, data: Uint8Array, offset: number): ParsedField {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return field(name, view.getInt32(0, false), offset, 4, "int32");
}

function readInt32(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, false);
}

/**
 * Big-endian int32 rendered in hex (`0x...`). For packed `(type << 24) | index` dwords (a PID/FID) where the
 * decimal form is illegible - mirrors the spec walker's `numericFormat: "hex32"` path so a hand-built trailer
 * field reads identically to a spec-driven one. `rawValue` stays the signed stored number; the round-trip is
 * byte-identical.
 */
export function hex32Field(name: string, data: Uint8Array, offset: number): ParsedField {
    const value = readInt32(data, offset);
    const display = `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
    return { name, value: display, offset, size: 4, type: "int32", rawValue: value, numericFormat: "hex32" };
}

/**
 * Big-endian int32 displayed as a flag-checkbox table. `flags` maps each named bit value to its label; unnamed
 * set bits are preserved in `rawValue` and simply not shown as checkboxes. Mirrors the spec walker's flags path
 * so a hand-built trailer flag field reads identically to a spec-driven one.
 */
export function flagsField(
    name: string,
    data: Uint8Array,
    offset: number,
    flags: Readonly<Record<number, string>>,
): ParsedField {
    const value = readInt32(data, offset);
    const active = Object.entries(flags)
        .filter(([bit]) => (value & Number(bit)) !== 0)
        .map(([, label]) => label);
    return {
        name,
        value: active.length > 0 ? active.join(", ") : "(none)",
        offset,
        size: 4,
        type: "flags",
        rawValue: value,
        flagOptions: stringifyKeys(flags),
    };
}

/**
 * Big-endian int32 resolved through a closed enum table. Unrecognized values display as `Unknown (N)` (matching
 * the spec walker), keeping arbitrary stored numbers round-trippable. Mirrors the spec walker's enum path so a
 * hand-built trailer enum field reads identically to a spec-driven one.
 */
export function enumField(
    name: string,
    data: Uint8Array,
    offset: number,
    options: Readonly<Record<number, string>>,
): ParsedField {
    const value = readInt32(data, offset);
    const resolved = options[value];
    return {
        name,
        value: resolved ?? `Unknown (${value})`,
        offset,
        size: 4,
        type: "enum",
        rawValue: value,
        enumOptions: stringifyKeys(options),
    };
}

export function noteField(name: string, value: string, offset: number): ParsedField {
    return field(name, value, offset, 0, "note");
}

/**
 * Field-name marker for note records that flag a partial / truncated /
 * undecodable region during MAP parsing. Used both as the visible label in
 * JSON snapshots and as the predicate for `hasTruncatedNote()` scoring checks.
 */
export const TRUNCATED_SENTINEL = "Truncated";

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

/**
 * The number in `group`'s field for spec key `key`, found under the label `presentation` gives it - the label the
 * parser emitted it with. Undefined when the field is absent or not numeric.
 */
export function fieldNumber<T>(
    group: ParsedGroup,
    presentation: StructPresentation<T>,
    key: keyof T & string,
): number | undefined {
    const label = fieldLabel(presentation, key);
    const found = group.fields.find((entry) => !("fields" in entry) && entry.name === label);
    if (!found || "fields" in found) {
        return undefined;
    }

    if (typeof found.rawValue === "number") {
        return found.rawValue;
    }

    return typeof found.value === "number" ? found.value : undefined;
}

/**
 * `group`'s child groups of one indexed kind, in order: each candidate is tested with the index the next match
 * would take, so `matches` compares against the label the parser built for that index (`mapGroupLabels`).
 */
export function indexedChildGroups(
    group: ParsedGroup,
    matches: (name: string, index: number) => boolean,
): ParsedGroup[] {
    const out: ParsedGroup[] = [];
    for (const entry of group.fields) {
        if ("fields" in entry && matches(entry.name, out.length)) out.push(entry);
    }
    return out;
}

/** The decoded objects of the elevation group for `elevation`, in order. */
export function elevationObjectGroups(elevationGroup: ParsedGroup, elevation: number): ParsedGroup[] {
    return indexedChildGroups(elevationGroup, (name, index) =>
        name.startsWith(mapGroupLabels.objectPrefix(`${elevation}.${index}`)),
    );
}
