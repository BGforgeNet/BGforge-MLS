import type { ParseOpaqueRange } from "./types";

const OPAQUE_HEX_CHUNK_BYTES = 32;

export function encodeOpaqueRange(
    label: string,
    data: Uint8Array,
    offset: number,
    end = data.length,
): ParseOpaqueRange | undefined {
    if (offset >= end) {
        return undefined;
    }

    const hexChunks: string[] = [];
    for (let pos = offset; pos < end; pos += OPAQUE_HEX_CHUNK_BYTES) {
        const chunk = data.subarray(pos, Math.min(pos + OPAQUE_HEX_CHUNK_BYTES, end));
        hexChunks.push(Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    }

    return {
        label,
        offset,
        size: end - offset,
        hexChunks,
    };
}

export function decodeOpaqueRange(range: ParseOpaqueRange): Uint8Array {
    const bytes = new Uint8Array(range.size);
    let writeOffset = 0;

    for (const hexChunk of range.hexChunks) {
        if (hexChunk.length % 2 !== 0) {
            throw new Error(`Opaque range "${range.label}" has an odd-length hex chunk`);
        }

        for (let index = 0; index < hexChunk.length; index += 2) {
            if (writeOffset >= bytes.length) {
                throw new Error(`Opaque range "${range.label}" exceeds declared size`);
            }

            const byte = Number.parseInt(hexChunk.slice(index, index + 2), 16);
            if (Number.isNaN(byte)) {
                throw new TypeError(`Opaque range "${range.label}" contains invalid hex data`);
            }
            bytes[writeOffset] = byte;
            writeOffset += 1;
        }
    }

    if (writeOffset !== bytes.length) {
        throw new Error(`Opaque range "${range.label}" size mismatch`);
    }

    return bytes;
}
