/**
 * Parse functions for the header, variables, tiles, and scripts sections of a MAP file.
 */

import type { ParseOpaqueRange, ParsedField, ParsedGroup } from "../types";
import { encodeOpaqueRange } from "../opaque-range";
import {
    MapVersion,
    MapFlags,
    MapElevation,
    Rotation,
    ScriptFlags,
    ScriptProc,
    ScriptType,
    Skill,
    hasElevation,
} from "./types";
import {
    HEADER_SIZE,
    TILE_DATA_SIZE_PER_ELEVATION,
    TILES_PER_ELEVATION,
    parseHeader,
    parseTilePair,
    getScriptType,
    type MapHeader,
} from "./schemas";
import {
    field,
    makeGroup,
    flagsField,
    enumField,
    int32Field,
    HEADER_PADDING_OFFSET,
    HEADER_PADDING_SIZE,
} from "./parse-helpers";

export function parseHeaderSection(data: Uint8Array, errors: string[]): ParsedGroup {
    const header = parseHeader(data);

    return makeGroup("Header", [
        enumField("Version", header.version, MapVersion, 0x00, 4, errors),
        field("Filename", header.filename, 0x04, 16, "string"),
        field("Default Position", header.defaultPosition, 0x14, 4, "int32"),
        enumField("Default Elevation", header.defaultElevation, MapElevation, 0x18, 4, errors),
        enumField("Default Orientation", header.defaultOrientation, Rotation, 0x1c, 4, errors),
        field("Num Local Vars", header.numLocalVars, 0x20, 4, "int32"),
        field("Script ID", header.scriptId, 0x24, 4, "int32"),
        flagsField("Map Flags", header.flags, MapFlags, 0x28, 4),
        field("Darkness", header.darkness, 0x2c, 4, "int32"),
        field("Num Global Vars", header.numGlobalVars, 0x30, 4, "int32"),
        field("Map ID", header.mapId, 0x34, 4, "int32"),
        field("Timestamp", header.timestamp, 0x38, 4, "uint32"),
        field(
            "Padding (field_3C)",
            `(${header.field_3C.length} values)`,
            HEADER_PADDING_OFFSET,
            HEADER_PADDING_SIZE,
            "padding",
        ),
    ]);
}

function parseVariables(
    data: Uint8Array,
    header: MapHeader,
): { globalVars: number[]; localVars: number[]; offset: number } {
    let offset = HEADER_SIZE;

    const globalVars: number[] = [];
    for (let i = 0; i < header.numGlobalVars; i++) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 4);
        globalVars.push(view.getInt32(0, false));
        offset += 4;
    }

    const localVars: number[] = [];
    for (let i = 0; i < header.numLocalVars; i++) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 4);
        localVars.push(view.getInt32(0, false));
        offset += 4;
    }

    return { globalVars, localVars, offset };
}

export function parseVariablesSection(data: Uint8Array, header: MapHeader): ParsedGroup[] {
    const { globalVars, localVars } = parseVariables(data, header);
    const groups: ParsedGroup[] = [];

    if (globalVars.length > 0) {
        const globalVarFields: ParsedField[] = globalVars.map((val, i) =>
            field(`Global Var ${i}`, val, HEADER_SIZE + i * 4, 4, "int32"),
        );
        groups.push(makeGroup("Global Variables", globalVarFields));
    }

    if (localVars.length > 0) {
        const localOffset = HEADER_SIZE + globalVars.length * 4;
        const localVarFields: ParsedField[] = localVars.map((val, i) =>
            field(`Local Var ${i}`, val, localOffset + i * 4, 4, "int32"),
        );
        groups.push(makeGroup("Local Variables", localVarFields));
    }

    return groups;
}

export function parseTiles(
    data: Uint8Array,
    header: MapHeader,
    currentOffset: number,
    skipMapTiles = false,
): { tiles: Map<number, ParsedGroup[]>; offset: number; skippedRange?: ParseOpaqueRange } {
    const tiles = new Map<number, ParsedGroup[]>();
    const tileSectionStart = currentOffset;

    for (let elev = 0; elev < 3; elev++) {
        if (!hasElevation(header.flags, elev)) continue;
        if (currentOffset + TILE_DATA_SIZE_PER_ELEVATION > data.length) {
            currentOffset = data.length;
            break;
        }

        const elevTiles: ParsedGroup[] = [];
        if (skipMapTiles) {
            tiles.set(elev, elevTiles);
            currentOffset += TILE_DATA_SIZE_PER_ELEVATION;
            continue;
        }

        const tileFields: ParsedField[] = [];

        for (let i = 0; i < TILES_PER_ELEVATION; i++) {
            if (currentOffset + i * 4 + 4 > data.length) break;
            const tilePair = parseTilePair(data, currentOffset + i * 4);
            if (tilePair.floorTileId !== 0 || tilePair.roofTileId !== 0) {
                tileFields.push(
                    field(`Tile ${i} Floor`, tilePair.floorTileId, currentOffset + i * 4, 2, "uint16"),
                    field(`Tile ${i} Floor Flags`, tilePair.floorFlags, currentOffset + i * 4, 1, "uint8"),
                    field(`Tile ${i} Roof`, tilePair.roofTileId, currentOffset + i * 4 + 2, 2, "uint16"),
                    field(`Tile ${i} Roof Flags`, tilePair.roofFlags, currentOffset + i * 4 + 2, 1, "uint8"),
                );
            }
        }

        if (tileFields.length > 0) {
            elevTiles.push(makeGroup(`Elevation ${elev} Tiles`, tileFields));
        }
        tiles.set(elev, elevTiles);
        currentOffset += TILE_DATA_SIZE_PER_ELEVATION;
    }

    const skippedRange = skipMapTiles ? encodeOpaqueRange("tiles", data, tileSectionStart, currentOffset) : undefined;

    return { tiles, offset: currentOffset, skippedRange };
}

function parseScriptEntryFields(
    data: Uint8Array,
    currentOffset: number,
    label: string,
    errors: string[],
): { fields: ParsedField[]; offset: number } {
    if (currentOffset + 8 > data.length) {
        errors.push(`Script entry ${label} truncated at offset 0x${currentOffset.toString(16)}`);
        return { fields: [], offset: data.length };
    }

    const fields: ParsedField[] = [];

    const sidView = new DataView(data.buffer, data.byteOffset + currentOffset, 4);
    const sid = sidView.getUint32(0, false);
    const actualScriptType = getScriptType(sid);

    fields.push(field(`${label} SID`, sid, currentOffset, 4, "uint32"));

    const field4View = new DataView(data.buffer, data.byteOffset + currentOffset + 4, 4);
    fields.push(
        field(`${label} Next Script Link (legacy)`, field4View.getInt32(0, false), currentOffset + 4, 4, "int32"),
    );

    let pos = 8;
    if (actualScriptType === 1) {
        const builtTileView = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        fields.push(field(`${label} Built Tile`, builtTileView.getInt32(0, false), currentOffset + pos, 4, "int32"));
        pos += 4;
        const radiusView = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        fields.push(field(`${label} Spatial Radius`, radiusView.getInt32(0, false), currentOffset + pos, 4, "int32"));
        pos += 4;
    } else if (actualScriptType === 2) {
        const timeView = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        fields.push(field(`${label} Timer Time`, timeView.getInt32(0, false), currentOffset + pos, 4, "int32"));
        pos += 4;
    }

    const commonNames = [
        "Flags",
        "Index",
        "Program Pointer Slot",
        "Owner ID",
        "Local Vars Offset",
        "Num Local Vars",
        "Return Value",
        "Action",
        "Fixed Param",
        "Action Being Used",
        "Script Overrides",
        "Unknown Field 0x48",
        "Check Margin (how_much)",
        "Legacy Field 0x50",
    ];
    for (const [index, name] of commonNames.entries()) {
        if (currentOffset + pos + 4 > data.length) {
            errors.push(`Script entry ${label} overflow at offset 0x${(currentOffset + pos).toString(16)}`);
            return { fields, offset: data.length };
        }

        const fview = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        const value = fview.getInt32(0, false);
        if (index === 0) {
            fields.push(flagsField(`${label} ${name}`, value, ScriptFlags, currentOffset + pos, 4));
        } else if (name === "Action") {
            fields.push(enumField(`${label} ${name}`, value, ScriptProc, currentOffset + pos, 4));
        } else if (name === "Action Being Used") {
            fields.push(enumField(`${label} ${name}`, value, Skill, currentOffset + pos, 4));
        } else {
            fields.push(field(`${label} ${name}`, value, currentOffset + pos, 4, "int32"));
        }
        pos += 4;
    }

    return { fields, offset: currentOffset + pos };
}

export function parseScripts(
    data: Uint8Array,
    currentOffset: number,
    errors: string[],
    scriptTypeCount: number,
): { scripts: ParsedGroup[]; offset: number } {
    const scripts: ParsedGroup[] = [];

    for (let scriptType = 0; scriptType < scriptTypeCount; scriptType++) {
        if (currentOffset + 4 > data.length) break;
        if (data.length - currentOffset < 4) break;
        const countOffset = currentOffset;
        const view = new DataView(data.buffer, data.byteOffset + currentOffset, 4);
        const count = view.getInt32(0, false);
        currentOffset += 4;

        if (count < 0) {
            break;
        }

        const scriptEntries: (ParsedField | ParsedGroup)[] = [field("Script Count", count, countOffset, 4, "int32")];

        if (count === 0) {
            scripts.push(makeGroup(`${ScriptType[scriptType] ?? `Type${scriptType}`} Scripts`, scriptEntries));
            continue;
        }
        if (currentOffset >= data.length) {
            scripts.push(makeGroup(`${ScriptType[scriptType] ?? `Type${scriptType}`} Scripts`, scriptEntries));
            break;
        }
        const extentCount = Math.ceil(count / 16);

        for (let extentIndex = 0; extentIndex < extentCount; extentIndex++) {
            const extentFields: (ParsedField | ParsedGroup)[] = [];

            for (let slotIndex = 0; slotIndex < 16; slotIndex++) {
                const entry = parseScriptEntryFields(
                    data,
                    currentOffset,
                    `Entry ${extentIndex * 16 + slotIndex}`,
                    errors,
                );
                if (entry.fields.length === 0) {
                    currentOffset = entry.offset;
                    break;
                }

                extentFields.push(makeGroup(`Slot ${slotIndex}`, entry.fields));
                currentOffset = entry.offset;
            }

            if (currentOffset + 8 > data.length) {
                errors.push(`Script extent ${extentIndex} metadata truncated for script type ${scriptType}`);
                break;
            }

            extentFields.push(
                int32Field("Extent Length", data, currentOffset),
                int32Field("Extent Next", data, currentOffset + 4),
            );
            currentOffset += 8;

            scriptEntries.push(makeGroup(`Extent ${extentIndex}`, extentFields));
        }

        scripts.push(makeGroup(`${ScriptType[scriptType] ?? `Type${scriptType}`} Scripts`, scriptEntries));
    }

    return { scripts, offset: currentOffset };
}
