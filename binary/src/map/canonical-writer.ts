/**
 * Writer helpers for serializing MapCanonicalDocument back to binary MAP format bytes.
 */

import { z } from "zod";
import { BufferWriter } from "typed-binary";
import { decodeOpaqueRange } from "../opaque-range";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { HEADER_SIZE, TILE_DATA_SIZE_PER_ELEVATION, getScriptType, tilePairCodec } from "./schemas";
import { mapHeaderSpec } from "./specs/header";
import { varSectionSpec, type VarSectionCtx } from "./specs/variables";
import {
    OTHER_SLOT_BYTES,
    SPATIAL_SLOT_BYTES,
    TIMER_SLOT_BYTES,
    otherSlotSpec,
    spatialSlotSpec,
    timerSlotSpec,
} from "./specs/script-slot";
import { objectBaseSpec, inventoryHeaderSpec, critterDataSpec, exitGridSpec } from "./specs/object";
import { hasElevation } from "./types";
import type { ParseOpaqueRange } from "../types";
import {
    mapHeaderSchema,
    mapTileElevationSchema,
    mapScriptSectionSchema,
    mapScriptSlotSchema,
    mapObjectSchema,
    mapObjectsSchema,
    MAP_OBJECT_BASE_SIZE,
    MAP_OBJECT_DATA_HEADER_SIZE,
    PID_TYPE_CRITTER,
    PID_TYPE_MISC,
    type MapCanonicalDocument,
} from "./canonical-schemas";

const headerCodec = toTypedBinarySchema(mapHeaderSpec);
const varSectionCodec = toTypedBinarySchema<typeof varSectionSpec, VarSectionCtx>(varSectionSpec);
const otherSlotCodec = toTypedBinarySchema(otherSlotSpec);
const spatialSlotCodec = toTypedBinarySchema(spatialSlotSpec);
const timerSlotCodec = toTypedBinarySchema(timerSlotSpec);
const objectBaseCodec = toTypedBinarySchema(objectBaseSpec);
const inventoryHeaderCodec = toTypedBinarySchema(inventoryHeaderSpec);
const critterDataCodec = toTypedBinarySchema(critterDataSpec);
const exitGridCodec = toTypedBinarySchema(exitGridSpec);

function bufferWriterAt(bytes: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(bytes.buffer, { endianness: "big", byteOffset: bytes.byteOffset + offset });
}

// Single-field big-endian helpers used for the few wire fields that
// don't fit into a struct spec (extent metadata, per-elevation object
// counts, inventory quantities, dataFlags). One-field-spec modules
// would be more code than the inline DataView write.
function writeInt32(bytes: Uint8Array, offset: number, value: number): void {
    new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setInt32(0, value, false);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
    new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value >>> 0, false);
}

function encodeFilename(filename: string): number[] {
    // Canonical filename is a string; the wire layout is 16 raw u8 bytes
    // padded with NULs. Truncate or zero-fill to match.
    const encoded = new TextEncoder().encode(filename);
    const out = Array.from<number>({ length: 16 }).fill(0);
    for (let i = 0; i < 16 && i < encoded.length; i++) out[i] = encoded[i]!;
    return out;
}

function serializeHeader(bytes: Uint8Array, header: z.infer<typeof mapHeaderSchema>): void {
    headerCodec.write(bufferWriterAt(bytes, 0), {
        version: header.version,
        filename: encodeFilename(header.filename),
        defaultPosition: header.defaultPosition,
        defaultElevation: header.defaultElevation,
        defaultOrientation: header.defaultOrientation,
        numLocalVars: header.numLocalVars,
        scriptId: header.scriptId,
        flags: header.flags,
        darkness: header.darkness,
        numGlobalVars: header.numGlobalVars,
        mapId: header.mapId,
        timestamp: header.timestamp,
        // The wire reserves 44×i32 of trailing space (`field_3C`) that the
        // canonical doc does not surface. Write zeros, matching what the
        // prior hand-rolled writer left in place from the buffer init.
        field_3C: Array.from<number>({ length: 44 }).fill(0),
    });
}

function serializeVariables(bytes: Uint8Array, globalVariables: number[], localVariables: number[]): number {
    let offset = HEADER_SIZE;
    varSectionCodec.write(bufferWriterAt(bytes, offset), { values: globalVariables });
    offset += globalVariables.length * 4;
    varSectionCodec.write(bufferWriterAt(bytes, offset), { values: localVariables });
    offset += localVariables.length * 4;
    return offset;
}

function serializeTiles(
    bytes: Uint8Array,
    header: z.infer<typeof mapHeaderSchema>,
    tiles: z.infer<typeof mapTileElevationSchema>[],
    offset: number,
): number {
    const tilesByElevation = new Map(tiles.map((entry) => [entry.elevation, entry]));
    for (let elevation = 0; elevation < 3; elevation++) {
        if (!hasElevation(header.flags, elevation)) {
            continue;
        }

        const tileElevation = tilesByElevation.get(elevation);
        for (const tile of tileElevation?.tiles ?? []) {
            tilePairCodec.write(bufferWriterAt(bytes, offset + tile.index * 4), {
                floorTileId: tile.floorTileId,
                floorFlags: tile.floorFlags,
                roofTileId: tile.roofTileId,
                roofFlags: tile.roofFlags,
            });
        }
        offset += TILE_DATA_SIZE_PER_ELEVATION;
    }
    return offset;
}

function serializeScriptSlot(bytes: Uint8Array, slot: z.infer<typeof mapScriptSlotSchema>, offset: number): number {
    const writer = bufferWriterAt(bytes, offset);
    const commons = {
        flags: slot.flags,
        index: slot.index,
        programPointerSlot: slot.programPointerSlot,
        ownerId: slot.ownerId,
        localVarsOffset: slot.localVarsOffset,
        numLocalVars: slot.numLocalVars,
        returnValue: slot.returnValue,
        action: slot.action,
        fixedParam: slot.fixedParam,
        actionBeingUsed: slot.actionBeingUsed,
        scriptOverrides: slot.scriptOverrides,
        unknownField0x48: slot.unknownField0x48,
        checkMarginHowMuch: slot.checkMarginHowMuch,
        legacyField0x50: slot.legacyField0x50,
    };
    switch (getScriptType(slot.sid)) {
        case 1:
            spatialSlotCodec.write(writer, {
                sid: slot.sid,
                nextScriptLinkLegacy: slot.nextScriptLinkLegacy,
                builtTile: slot.builtTile ?? 0,
                spatialRadius: slot.spatialRadius ?? 0,
                ...commons,
            });
            return offset + SPATIAL_SLOT_BYTES;
        case 2:
            timerSlotCodec.write(writer, {
                sid: slot.sid,
                nextScriptLinkLegacy: slot.nextScriptLinkLegacy,
                timerTime: slot.timerTime ?? 0,
                ...commons,
            });
            return offset + TIMER_SLOT_BYTES;
        default:
            otherSlotCodec.write(writer, {
                sid: slot.sid,
                nextScriptLinkLegacy: slot.nextScriptLinkLegacy,
                ...commons,
            });
            return offset + OTHER_SLOT_BYTES;
    }
}

function serializeScripts(
    bytes: Uint8Array,
    scripts: z.infer<typeof mapScriptSectionSchema>[],
    offset: number,
): number {
    for (const scriptSection of scripts) {
        writeInt32(bytes, offset, scriptSection.count);
        offset += 4;
        if (scriptSection.count === 0) {
            continue;
        }

        for (const extent of scriptSection.extents) {
            for (const slot of extent.slots) {
                offset = serializeScriptSlot(bytes, slot, offset);
            }
            writeInt32(bytes, offset, extent.extentLength);
            writeInt32(bytes, offset + 4, extent.extentNext);
            offset += 8;
        }
    }
    return offset;
}

function objectSerializedLength(object: z.infer<typeof mapObjectSchema>): number {
    let length = MAP_OBJECT_BASE_SIZE + MAP_OBJECT_DATA_HEADER_SIZE;
    const pidType = (object.base.pid >>> 24) & 0xff;
    if (pidType === PID_TYPE_CRITTER) {
        length += 44;
    } else {
        length += 4;
        if (pidType === PID_TYPE_MISC && object.exitGrid) {
            length += 16;
        }
    }
    for (const entry of object.inventory) {
        length += 4 + objectSerializedLength(entry.object);
    }
    return length;
}

function serializeMapObject(bytes: Uint8Array, object: z.infer<typeof mapObjectSchema>, offset: number): number {
    objectBaseCodec.write(bufferWriterAt(bytes, offset), object.base);
    let currentOffset = offset + MAP_OBJECT_BASE_SIZE;
    inventoryHeaderCodec.write(bufferWriterAt(bytes, currentOffset), object.inventoryHeader);
    currentOffset += MAP_OBJECT_DATA_HEADER_SIZE;

    const pidType = (object.base.pid >>> 24) & 0xff;
    if (pidType === PID_TYPE_CRITTER) {
        if (!object.critterData) {
            throw new Error("critterData is required for critter MAP objects");
        }
        critterDataCodec.write(bufferWriterAt(bytes, currentOffset), object.critterData);
        currentOffset += 44;
    } else {
        writeUint32(bytes, currentOffset, object.objectData?.dataFlags ?? 0);
        currentOffset += 4;

        if (pidType === PID_TYPE_MISC && object.exitGrid) {
            exitGridCodec.write(bufferWriterAt(bytes, currentOffset), object.exitGrid);
            currentOffset += 16;
        }
    }

    for (const entry of object.inventory) {
        writeInt32(bytes, currentOffset, entry.quantity);
        currentOffset += 4;
        currentOffset = serializeMapObject(bytes, entry.object, currentOffset);
    }

    return currentOffset;
}

function serializeObjects(bytes: Uint8Array, objects: z.infer<typeof mapObjectsSchema>, offset: number): number {
    writeInt32(bytes, offset, objects.totalObjects);
    offset += 4;
    for (const elevation of objects.elevations) {
        writeInt32(bytes, offset, elevation.objectCount);
        offset += 4;
        for (const object of elevation.objects) {
            offset = serializeMapObject(bytes, object, offset);
        }
    }
    return offset;
}

function objectsSerializedLength(objects: z.infer<typeof mapObjectsSchema>): number {
    let length = 4 + objects.elevations.length * 4;
    for (const elevation of objects.elevations) {
        for (const object of elevation.objects) {
            length += objectSerializedLength(object);
        }
    }
    return length;
}

function applyOpaqueRanges(target: Uint8Array, opaqueRanges?: ParseOpaqueRange[]): void {
    for (const opaqueRange of opaqueRanges ?? []) {
        target.set(decodeOpaqueRange(opaqueRange), opaqueRange.offset);
    }
}

function tileSectionLength(header: z.infer<typeof mapHeaderSchema>): number {
    let length = 0;
    for (let elevation = 0; elevation < 3; elevation++) {
        if (hasElevation(header.flags, elevation)) {
            length += TILE_DATA_SIZE_PER_ELEVATION;
        }
    }
    return length;
}

function scriptSectionLength(scripts: z.infer<typeof mapScriptSectionSchema>[]): number {
    let length = 0;
    for (const section of scripts) {
        length += 4;
        if (section.count === 0) {
            continue;
        }
        for (const extent of section.extents) {
            for (const slot of extent.slots) {
                let slotLength = 64;
                switch (getScriptType(slot.sid)) {
                    case 1:
                        slotLength += 8;
                        break;
                    case 2:
                        slotLength += 4;
                        break;
                }
                length += slotLength;
            }
            length += 8;
        }
    }
    return length;
}

/**
 * Caller contract: `opaqueRanges` offsets are written verbatim — the writer
 * does not adjust them to match the new layout it computes from `document`.
 * For round-trip and JSON-snapshot paths the document and opaqueRanges come
 * from the same parse, so the offsets already match. For structural
 * mutations that resize earlier sections (entity add/remove on the var
 * arrays, hypothetical future object-record resizes), the caller MUST
 * re-anchor any range whose offset falls in or after the resized region
 * before calling, or the resulting bytes will be silently misaligned by
 * the size delta. See `entity-ops.ts:shiftOpaqueRangesAfterVarSection`
 * for the var-section-specific helper.
 */
export function serializeMapCanonicalDocument(
    document: MapCanonicalDocument,
    opaqueRanges?: ParseOpaqueRange[],
): Uint8Array {
    const computedLength =
        HEADER_SIZE +
        (document.globalVariables.length + document.localVariables.length) * 4 +
        tileSectionLength(document.header) +
        scriptSectionLength(document.scripts) +
        objectsSerializedLength(document.objects);
    const opaqueEnd = Math.max(0, ...(opaqueRanges ?? []).map((range) => range.offset + range.size));
    const bytes = new Uint8Array(Math.max(computedLength, opaqueEnd));

    serializeHeader(bytes, document.header);
    let offset = serializeVariables(bytes, document.globalVariables, document.localVariables);
    offset = serializeTiles(bytes, document.header, document.tiles, offset);
    offset = serializeScripts(bytes, document.scripts, offset);
    offset = serializeObjects(bytes, document.objects, offset);
    void offset;

    applyOpaqueRanges(bytes, opaqueRanges);
    return bytes;
}
