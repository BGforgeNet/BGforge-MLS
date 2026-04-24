/**
 * Writer helpers for serializing MapCanonicalDocument back to binary MAP format bytes.
 */

import { z } from "zod";
import { decodeOpaqueRange } from "./opaque-range";
import { HEADER_SIZE, TILE_DATA_SIZE_PER_ELEVATION, getScriptType } from "./map-schemas";
import { hasElevation } from "./map-types";
import type { ParseOpaqueRange } from "./types";
import {
    mapHeaderSchema,
    mapTileElevationSchema,
    mapScriptSectionSchema,
    mapScriptSlotSchema,
    mapObjectBaseSchema,
    mapObjectSchema,
    mapObjectsSchema,
    MAP_OBJECT_BASE_SIZE,
    MAP_OBJECT_DATA_HEADER_SIZE,
    PID_TYPE_CRITTER,
    PID_TYPE_MISC,
    type MapCanonicalDocument,
} from "./map-canonical-schemas";

function writeInt32(view: DataView, offset: number, value: number): void {
    view.setInt32(offset, value, false);
}

function writeUint32(view: DataView, offset: number, value: number): void {
    view.setUint32(offset, value >>> 0, false);
}

function serializeHeader(bytes: Uint8Array, header: z.infer<typeof mapHeaderSchema>): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    writeUint32(view, 0x00, header.version);
    const filenameBytes = new TextEncoder().encode(header.filename);
    for (let index = 0; index < 16; index++) {
        view.setUint8(0x04 + index, filenameBytes[index] ?? 0);
    }
    writeInt32(view, 0x14, header.defaultPosition);
    writeInt32(view, 0x18, header.defaultElevation);
    writeInt32(view, 0x1c, header.defaultOrientation);
    writeInt32(view, 0x20, header.numLocalVars);
    writeInt32(view, 0x24, header.scriptId);
    writeUint32(view, 0x28, header.flags);
    writeInt32(view, 0x2c, header.darkness);
    writeInt32(view, 0x30, header.numGlobalVars);
    writeInt32(view, 0x34, header.mapId);
    writeUint32(view, 0x38, header.timestamp);
}

function serializeVariables(view: DataView, globalVariables: number[], localVariables: number[]): number {
    let offset = HEADER_SIZE;
    for (const value of globalVariables) {
        writeInt32(view, offset, value);
        offset += 4;
    }
    for (const value of localVariables) {
        writeInt32(view, offset, value);
        offset += 4;
    }
    return offset;
}

function serializeTiles(
    view: DataView,
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
            const word =
                ((tile.roofFlags & 0x0f) << 28) |
                ((tile.roofTileId & 0x0f_ff) << 16) |
                ((tile.floorFlags & 0x0f) << 12) |
                (tile.floorTileId & 0x0f_ff);
            writeUint32(view, offset + tile.index * 4, word);
        }
        offset += TILE_DATA_SIZE_PER_ELEVATION;
    }
    return offset;
}

function serializeScriptSlot(view: DataView, slot: z.infer<typeof mapScriptSlotSchema>, offset: number): number {
    writeUint32(view, offset, slot.sid);
    writeInt32(view, offset + 4, slot.nextScriptLinkLegacy);
    let currentOffset = offset + 8;

    switch (getScriptType(slot.sid)) {
        case 1:
            writeInt32(view, currentOffset, slot.builtTile ?? 0);
            writeInt32(view, currentOffset + 4, slot.spatialRadius ?? 0);
            currentOffset += 8;
            break;
        case 2:
            writeInt32(view, currentOffset, slot.timerTime ?? 0);
            currentOffset += 4;
            break;
    }

    const commonValues = [
        slot.flags,
        slot.index,
        slot.programPointerSlot,
        slot.ownerId,
        slot.localVarsOffset,
        slot.numLocalVars,
        slot.returnValue,
        slot.action,
        slot.fixedParam,
        slot.actionBeingUsed,
        slot.scriptOverrides,
        slot.unknownField0x48,
        slot.checkMarginHowMuch,
        slot.legacyField0x50,
    ];

    for (const value of commonValues) {
        writeInt32(view, currentOffset, value);
        currentOffset += 4;
    }

    return currentOffset;
}

function serializeScripts(view: DataView, scripts: z.infer<typeof mapScriptSectionSchema>[], offset: number): number {
    for (const scriptSection of scripts) {
        writeInt32(view, offset, scriptSection.count);
        offset += 4;
        if (scriptSection.count === 0) {
            continue;
        }

        for (const extent of scriptSection.extents) {
            for (const slot of extent.slots) {
                offset = serializeScriptSlot(view, slot, offset);
            }
            writeInt32(view, offset, extent.extentLength);
            writeInt32(view, offset + 4, extent.extentNext);
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

function writeObjectBase(view: DataView, base: z.infer<typeof mapObjectBaseSchema>, offset: number): void {
    writeInt32(view, offset + 0, base.id);
    writeInt32(view, offset + 4, base.tile);
    writeInt32(view, offset + 8, base.x);
    writeInt32(view, offset + 12, base.y);
    writeInt32(view, offset + 16, base.screenX);
    writeInt32(view, offset + 20, base.screenY);
    writeInt32(view, offset + 24, base.frame);
    writeInt32(view, offset + 28, base.rotation);
    writeUint32(view, offset + 32, base.fid);
    writeInt32(view, offset + 36, base.flags);
    writeInt32(view, offset + 40, base.elevation);
    writeInt32(view, offset + 44, base.pid);
    writeInt32(view, offset + 48, base.cid);
    writeInt32(view, offset + 52, base.lightDistance);
    writeInt32(view, offset + 56, base.lightIntensity);
    writeInt32(view, offset + 60, base.field74);
    writeInt32(view, offset + 64, base.sid);
    writeInt32(view, offset + 68, base.scriptIndex);
}

function serializeMapObject(view: DataView, object: z.infer<typeof mapObjectSchema>, offset: number): number {
    writeObjectBase(view, object.base, offset);
    let currentOffset = offset + MAP_OBJECT_BASE_SIZE;
    writeInt32(view, currentOffset, object.inventoryHeader.inventoryLength);
    writeInt32(view, currentOffset + 4, object.inventoryHeader.inventoryCapacity);
    writeInt32(view, currentOffset + 8, object.inventoryHeader.inventoryPointer);
    currentOffset += MAP_OBJECT_DATA_HEADER_SIZE;

    const pidType = (object.base.pid >>> 24) & 0xff;
    if (pidType === PID_TYPE_CRITTER) {
        const critterData = object.critterData;
        if (!critterData) {
            throw new Error("critterData is required for critter MAP objects");
        }
        const values = [
            critterData.reaction,
            critterData.damageLastTurn,
            critterData.combatManeuver,
            critterData.currentAp,
            critterData.combatResults,
            critterData.aiPacket,
            critterData.team,
            critterData.whoHitMeCid,
            critterData.currentHp,
            critterData.radiation,
            critterData.poison,
        ];
        for (const value of values) {
            writeInt32(view, currentOffset, value);
            currentOffset += 4;
        }
    } else {
        writeUint32(view, currentOffset, object.objectData?.dataFlags ?? 0);
        currentOffset += 4;

        if (pidType === PID_TYPE_MISC && object.exitGrid) {
            writeInt32(view, currentOffset, object.exitGrid.destinationMap);
            writeInt32(view, currentOffset + 4, object.exitGrid.destinationTile);
            writeInt32(view, currentOffset + 8, object.exitGrid.destinationElevation);
            writeInt32(view, currentOffset + 12, object.exitGrid.destinationRotation);
            currentOffset += 16;
        }
    }

    for (const entry of object.inventory) {
        writeInt32(view, currentOffset, entry.quantity);
        currentOffset += 4;
        currentOffset = serializeMapObject(view, entry.object, currentOffset);
    }

    return currentOffset;
}

function serializeObjects(view: DataView, objects: z.infer<typeof mapObjectsSchema>, offset: number): number {
    writeInt32(view, offset, objects.totalObjects);
    offset += 4;
    for (const elevation of objects.elevations) {
        writeInt32(view, offset, elevation.objectCount);
        offset += 4;
        for (const object of elevation.objects) {
            offset = serializeMapObject(view, object, offset);
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
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    serializeHeader(bytes, document.header);
    let offset = serializeVariables(view, document.globalVariables, document.localVariables);
    offset = serializeTiles(view, document.header, document.tiles, offset);
    offset = serializeScripts(view, document.scripts, offset);
    offset = serializeObjects(view, document.objects, offset);
    void offset;

    applyOpaqueRanges(bytes, opaqueRanges);
    return bytes;
}
