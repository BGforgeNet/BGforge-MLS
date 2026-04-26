/**
 * MAP file format helpers.
 *
 * MAP files are big-endian and have several variable-length sections. The
 * fixed-size header is now spec-driven (`specs/header.ts` → typed-binary
 * codec); the variable-length sections (header vars, tiles, scripts, objects)
 * are still hand-parsed in `parse-sections.ts` / `parse-objects.ts`.
 */

import { BufferReader } from "typed-binary";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { mapHeaderSpec } from "./specs/header";

export const HEADER_SIZE = 0xf0;

export interface MapHeader {
    version: number;
    filename: string;
    defaultPosition: number;
    defaultElevation: number;
    defaultOrientation: number;
    numLocalVars: number;
    scriptId: number;
    flags: number;
    darkness: number;
    numGlobalVars: number;
    mapId: number;
    timestamp: number;
    field_3C: number[];
}

const headerCodec = toTypedBinarySchema(mapHeaderSpec);

export function parseHeader(data: Uint8Array): MapHeader {
    const reader = new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset });
    const wire = headerCodec.read(reader);
    const nullIdx = wire.filename.indexOf(0);
    const filenameLen = nullIdx === -1 ? wire.filename.length : nullIdx;
    const filename = String.fromCharCode(...wire.filename.slice(0, filenameLen));
    return {
        version: wire.version,
        filename,
        defaultPosition: wire.defaultPosition,
        defaultElevation: wire.defaultElevation,
        defaultOrientation: wire.defaultOrientation,
        numLocalVars: wire.numLocalVars,
        scriptId: wire.scriptId,
        flags: wire.flags,
        darkness: wire.darkness,
        numGlobalVars: wire.numGlobalVars,
        mapId: wire.mapId,
        timestamp: wire.timestamp,
        field_3C: wire.field_3C,
    };
}

export function getScriptType(sid: number): number {
    return (sid >>> 24) & 0xf;
}

export const TILES_PER_ELEVATION = 10_000;
export const TILE_DATA_SIZE_PER_ELEVATION = TILES_PER_ELEVATION * 4;

interface TilePair {
    floorTileId: number;
    floorFlags: number;
    roofTileId: number;
    roofFlags: number;
}

export function parseTilePair(data: Uint8Array, offset: number): TilePair {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    const word = view.getUint32(0, false);
    return {
        floorTileId: word & 0xf_ff,
        floorFlags: (word >> 12) & 0xf,
        roofTileId: (word >> 16) & 0xf_ff,
        roofFlags: (word >> 28) & 0xf,
    };
}
