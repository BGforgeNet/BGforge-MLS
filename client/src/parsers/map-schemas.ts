/**
 * typed-binary schema definitions for MAP file format.
 * MAP files are big-endian and have several variable-length sections.
 * We use typed-binary for fixed-size sub-structures but handle the
 * variable-length sections (header vars, tiles, scripts, objects) separately.
 */

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

export function parseHeader(data: Uint8Array): MapHeader {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const filenameBytes = new Uint8Array(data.buffer, data.byteOffset + 4, 16);
    const filenameEnd = filenameBytes.indexOf(0);
    const filename = String.fromCharCode(
        ...filenameBytes.subarray(0, filenameEnd === -1 ? filenameBytes.length : filenameEnd),
    );

    const field_3C: number[] = [];
    for (let i = 0; i < 44; i++) {
        field_3C.push(view.getInt32(60 + i * 4, false));
    }

    return {
        version: view.getUint32(0, false),
        filename,
        defaultPosition: view.getInt32(20, false),
        defaultElevation: view.getInt32(24, false),
        defaultOrientation: view.getInt32(28, false),
        numLocalVars: view.getInt32(32, false),
        scriptId: view.getInt32(36, false),
        flags: view.getUint32(40, false),
        darkness: view.getInt32(44, false),
        numGlobalVars: view.getInt32(48, false),
        mapId: view.getInt32(52, false),
        timestamp: view.getUint32(56, false),
        field_3C,
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
