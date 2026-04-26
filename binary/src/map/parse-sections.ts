/**
 * Parse functions for the header, variables, tiles, and scripts sections of a MAP file.
 */

import { BufferReader } from "typed-binary";
import type { ParseOpaqueRange, ParsedField, ParsedGroup } from "../types";
import { encodeOpaqueRange } from "../opaque-range";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
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
    tilePairCodec,
    getScriptType,
    type MapHeader,
} from "./schemas";
import { varSectionSpec, type VarSectionCtx } from "./specs/variables";
import {
    OTHER_SLOT_BYTES,
    SPATIAL_SLOT_BYTES,
    TIMER_SLOT_BYTES,
    otherSlotSpec,
    spatialSlotSpec,
    timerSlotSpec,
    type OtherSlotData,
    type SpatialSlotData,
    type TimerSlotData,
} from "./specs/script-slot";
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

function clampVarCount(rawCount: number, label: "global" | "local", remainingBytes: number, errors: string[]): number {
    // numGlobalVars / numLocalVars are signed int32 values read straight out of the
    // file header. A crafted MAP can put any value there, including a large positive
    // count that would otherwise iterate billions of times before the per-iteration
    // DataView bounds check fires. Clamp to what the remaining buffer can possibly
    // hold (one int32 per slot) and surface an error so the caller knows the file
    // was rejected as malformed rather than silently truncated.
    const maxCount = Math.max(0, Math.floor(remainingBytes / 4));
    if (rawCount < 0 || rawCount > maxCount) {
        errors.push(
            `Map header reports ${rawCount} ${label} vars but only ${maxCount} fit in the remaining buffer; treating as malformed`,
        );
        return 0;
    }
    return rawCount;
}

const varSectionCodec = toTypedBinarySchema<typeof varSectionSpec, VarSectionCtx>(varSectionSpec);

function parseVariables(
    data: Uint8Array,
    header: MapHeader,
    errors: string[],
): { globalVars: number[]; localVars: number[]; offset: number } {
    let offset = HEADER_SIZE;

    const globalCount = clampVarCount(header.numGlobalVars, "global", data.byteLength - offset, errors);
    const globalReader = new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
    const globalVars = varSectionCodec.read(globalReader, { count: globalCount }).values;
    offset += globalCount * 4;

    const localCount = clampVarCount(header.numLocalVars, "local", data.byteLength - offset, errors);
    const localReader = new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
    const localVars = varSectionCodec.read(localReader, { count: localCount }).values;
    offset += localCount * 4;

    return { globalVars, localVars, offset };
}

export function parseVariablesSection(data: Uint8Array, header: MapHeader, errors: string[]): ParsedGroup[] {
    const { globalVars, localVars } = parseVariables(data, header, errors);
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
        // Decode the elevation as one contiguous run: a single BufferReader
        // amortises setup across all 10 000 pairs.
        const tileReader = new BufferReader(data.buffer, {
            endianness: "big",
            byteOffset: data.byteOffset + currentOffset,
        });

        for (let i = 0; i < TILES_PER_ELEVATION; i++) {
            if (currentOffset + i * 4 + 4 > data.length) break;
            const tilePair = tilePairCodec.read(tileReader);
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

const otherSlotCodec = toTypedBinarySchema(otherSlotSpec);
const spatialSlotCodec = toTypedBinarySchema(spatialSlotSpec);
const timerSlotCodec = toTypedBinarySchema(timerSlotSpec);

type AnySlotData = OtherSlotData | SpatialSlotData | TimerSlotData;

function appendSlotCommonFields(fields: ParsedField[], slot: AnySlotData, label: string, commonOffset: number): void {
    fields.push(flagsField(`${label} Flags`, slot.flags, ScriptFlags, commonOffset, 4));
    fields.push(field(`${label} Index`, slot.index, commonOffset + 4, 4, "int32"));
    fields.push(field(`${label} Program Pointer Slot`, slot.programPointerSlot, commonOffset + 8, 4, "int32"));
    fields.push(field(`${label} Owner ID`, slot.ownerId, commonOffset + 12, 4, "int32"));
    fields.push(field(`${label} Local Vars Offset`, slot.localVarsOffset, commonOffset + 16, 4, "int32"));
    fields.push(field(`${label} Num Local Vars`, slot.numLocalVars, commonOffset + 20, 4, "int32"));
    fields.push(field(`${label} Return Value`, slot.returnValue, commonOffset + 24, 4, "int32"));
    fields.push(enumField(`${label} Action`, slot.action, ScriptProc, commonOffset + 28, 4));
    fields.push(field(`${label} Fixed Param`, slot.fixedParam, commonOffset + 32, 4, "int32"));
    fields.push(enumField(`${label} Action Being Used`, slot.actionBeingUsed, Skill, commonOffset + 36, 4));
    fields.push(field(`${label} Script Overrides`, slot.scriptOverrides, commonOffset + 40, 4, "int32"));
    fields.push(field(`${label} Unknown Field 0x48`, slot.unknownField0x48, commonOffset + 44, 4, "int32"));
    fields.push(field(`${label} Check Margin (how_much)`, slot.checkMarginHowMuch, commonOffset + 48, 4, "int32"));
    fields.push(field(`${label} Legacy Field 0x50`, slot.legacyField0x50, commonOffset + 52, 4, "int32"));
}

function parseScriptEntryFields(
    data: Uint8Array,
    currentOffset: number,
    label: string,
    errors: string[],
): { fields: ParsedField[]; offset: number } {
    // Need at least sid+nextLink to even peek the discriminator.
    if (currentOffset + 8 > data.length) {
        errors.push(`Script entry ${label} truncated at offset 0x${currentOffset.toString(16)}`);
        return { fields: [], offset: data.length };
    }

    // Peek sid (without consuming through the spec codec) so we can pick
    // the variant whose layout matches the wire bytes.
    const sidView = new DataView(data.buffer, data.byteOffset + currentOffset, 4);
    const sid = sidView.getUint32(0, false);
    const scriptType = getScriptType(sid);

    const slotBytes = scriptType === 1 ? SPATIAL_SLOT_BYTES : scriptType === 2 ? TIMER_SLOT_BYTES : OTHER_SLOT_BYTES;
    if (currentOffset + slotBytes > data.length) {
        errors.push(`Script entry ${label} overflow at offset 0x${currentOffset.toString(16)}`);
        return { fields: [], offset: data.length };
    }

    const reader = new BufferReader(data.buffer, {
        endianness: "big",
        byteOffset: data.byteOffset + currentOffset,
    });

    const fields: ParsedField[] = [];

    if (scriptType === 1) {
        const slot = spatialSlotCodec.read(reader);
        fields.push(field(`${label} SID`, slot.sid, currentOffset, 4, "uint32"));
        fields.push(
            field(`${label} Next Script Link (legacy)`, slot.nextScriptLinkLegacy, currentOffset + 4, 4, "int32"),
        );
        fields.push(field(`${label} Built Tile`, slot.builtTile, currentOffset + 8, 4, "int32"));
        fields.push(field(`${label} Spatial Radius`, slot.spatialRadius, currentOffset + 12, 4, "int32"));
        appendSlotCommonFields(fields, slot, label, currentOffset + 16);
    } else if (scriptType === 2) {
        const slot = timerSlotCodec.read(reader);
        fields.push(field(`${label} SID`, slot.sid, currentOffset, 4, "uint32"));
        fields.push(
            field(`${label} Next Script Link (legacy)`, slot.nextScriptLinkLegacy, currentOffset + 4, 4, "int32"),
        );
        fields.push(field(`${label} Timer Time`, slot.timerTime, currentOffset + 8, 4, "int32"));
        appendSlotCommonFields(fields, slot, label, currentOffset + 12);
    } else {
        const slot = otherSlotCodec.read(reader);
        fields.push(field(`${label} SID`, slot.sid, currentOffset, 4, "uint32"));
        fields.push(
            field(`${label} Next Script Link (legacy)`, slot.nextScriptLinkLegacy, currentOffset + 4, 4, "int32"),
        );
        appendSlotCommonFields(fields, slot, label, currentOffset + 8);
    }

    return { fields, offset: currentOffset + slotBytes };
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
