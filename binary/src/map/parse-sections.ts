/**
 * Parse functions for the header, variables, tiles, and scripts sections of a MAP file.
 */

import { BufferReader } from "typed-binary";
import type { ParseOpaqueRange, ParsedField, ParsedGroup } from "../types";
import { encodeOpaqueRange } from "../opaque-range";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { ScriptType, hasElevation } from "./types";
import {
    HEADER_SIZE,
    TILE_DATA_SIZE_PER_ELEVATION,
    TILES_PER_ELEVATION,
    parseHeader,
    tilePairCodec,
    getScriptType,
    type MapHeader,
} from "./schemas";
import { mapHeaderCanonicalSpec, mapHeaderPresentation } from "./specs/header";
import { varSectionSpec, type VarSectionCtx } from "./specs/variables";
import {
    OTHER_SLOT_BYTES,
    SPATIAL_SLOT_BYTES,
    TIMER_SLOT_BYTES,
    otherSlotSpec,
    otherSlotPresentation,
    spatialSlotSpec,
    spatialSlotPresentation,
    timerSlotSpec,
    timerSlotPresentation,
} from "./specs/script-slot";
import { walkStruct } from "../spec/walk-display";
import { field, makeGroup, int32Field, HEADER_PADDING_OFFSET, HEADER_PADDING_SIZE } from "./parse-helpers";

export function parseHeaderSection(data: Uint8Array, _errors: string[]): ParsedGroup {
    const header = parseHeader(data);

    // walkStruct produces the 11 numeric/enum/flags rows from the spec +
    // presentation. Filename (string) and Padding (field_3C summary) sit
    // outside that scalar set and are spliced in at their wire positions.
    // The cast widens MapHeader (specific shape) to walkStruct's generic
    // record constraint; the spec keys are a subset of MapHeader's so the
    // runtime access is sound.
    //
    // Out-of-enum values surface inline as `Unknown (N)`; they are not pushed
    // to `errors` because the parser is read-permissive (mirroring PRO). The
    // strict gate against committable garbage lives at the canonical-write
    // path; here we just describe what the file actually says.
    const numericGroup = walkStruct(
        mapHeaderCanonicalSpec,
        mapHeaderPresentation,
        0,
        header as unknown as Record<string, number>,
        "Header",
    );

    const fields = [...numericGroup.fields];
    fields.splice(1, 0, field("Filename", header.filename, 0x04, 16, "string"));
    fields.push(
        field(
            "Padding (field_3C)",
            `(${header.field_3C.length} values)`,
            HEADER_PADDING_OFFSET,
            HEADER_PADDING_SIZE,
            "padding",
        ),
    );
    return makeGroup("Header", fields);
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

    let group: ParsedGroup;
    if (scriptType === 1) {
        const slot = spatialSlotCodec.read(reader);
        group = walkStruct(spatialSlotSpec, spatialSlotPresentation, currentOffset, slot, label, {
            labelPrefix: label,
        });
    } else if (scriptType === 2) {
        const slot = timerSlotCodec.read(reader);
        group = walkStruct(timerSlotSpec, timerSlotPresentation, currentOffset, slot, label, { labelPrefix: label });
    } else {
        const slot = otherSlotCodec.read(reader);
        group = walkStruct(otherSlotSpec, otherSlotPresentation, currentOffset, slot, label, { labelPrefix: label });
    }

    return { fields: group.fields as ParsedField[], offset: currentOffset + slotBytes };
}

export function parseScripts(
    data: Uint8Array,
    currentOffset: number,
    errors: string[],
    scriptTypeCount: number,
): { scripts: ParsedGroup[]; offset: number; overflowStart?: number } {
    const scripts: ParsedGroup[] = [];

    // Earliest disk offset whose bytes were not captured into `scripts` (i.e.
    // would be lost if the writer reconstructed only from the canonical doc).
    // The caller surfaces this as a `script-section-tail` opaque range so the
    // writer can replay the original bytes verbatim and preserve byte identity
    // for files the parser couldn't fully decode (per-slot SID widths
    // determined by accidental engine-scratch bytes, malformed counts, etc.).
    let overflowStart: number | undefined;

    for (let scriptType = 0; scriptType < scriptTypeCount; scriptType++) {
        if (currentOffset + 4 > data.length) {
            if (currentOffset < data.length && overflowStart === undefined) {
                overflowStart = currentOffset;
            }
            break;
        }
        const countOffset = currentOffset;
        const view = new DataView(data.buffer, data.byteOffset + currentOffset, 4);
        const count = view.getInt32(0, false);
        currentOffset += 4;

        if (count < 0) {
            // Count consumed but not pushed: 4 bytes already read are lost.
            overflowStart = countOffset;
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

        let scriptTypeAborted = false;
        for (let extentIndex = 0; extentIndex < extentCount; extentIndex++) {
            const extentStart = currentOffset;
            const extentFields: (ParsedField | ParsedGroup)[] = [];
            let extentAborted = false;

            for (let slotIndex = 0; slotIndex < 16; slotIndex++) {
                const entry = parseScriptEntryFields(
                    data,
                    currentOffset,
                    `Entry ${extentIndex * 16 + slotIndex}`,
                    errors,
                );
                if (entry.fields.length === 0) {
                    currentOffset = entry.offset;
                    extentAborted = true;
                    break;
                }

                extentFields.push(makeGroup(`Slot ${slotIndex}`, entry.fields));
                currentOffset = entry.offset;
            }

            if (extentAborted || currentOffset + 8 > data.length) {
                if (!extentAborted) {
                    errors.push(`Script extent ${extentIndex} metadata truncated for script type ${scriptType}`);
                }
                // The in-progress extent (and any successfully-read slots inside it)
                // is dropped from the canonical doc — the writer would otherwise
                // emit fewer bytes than the parser consumed for the same extent.
                // Anchor the trailer at this extent's disk start; the writer will
                // replay [extentStart..EOF] verbatim.
                overflowStart = extentStart;
                scriptTypeAborted = true;
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
        if (scriptTypeAborted) break;
    }

    return { scripts, offset: currentOffset, overflowStart };
}
