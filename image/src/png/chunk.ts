import { crc32 } from "./crc.ts";

export const PNG_SIGNATURE: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngChunk {
    type: string;
    data: Uint8Array;
}

function typeBytes(type: string): Uint8Array {
    return new TextEncoder().encode(type);
}

export function writeChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBuf = typeBytes(type);
    const crcInput = new Uint8Array(typeBuf.length + data.length);
    crcInput.set(typeBuf, 0);
    crcInput.set(data, typeBuf.length);
    const crc = crc32(crcInput);

    const out = new Uint8Array(4 + typeBuf.length + data.length + 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    out.set(typeBuf, 4);
    out.set(data, 4 + typeBuf.length);
    view.setUint32(4 + typeBuf.length + data.length, crc, false);
    return out;
}

export function readChunks(bytes: Uint8Array): PngChunk[] {
    if (bytes.length < PNG_SIGNATURE.length) {
        throw new Error("PNG data is shorter than the signature");
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) {
            throw new Error("PNG signature mismatch");
        }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks: PngChunk[] = [];
    let offset = PNG_SIGNATURE.length;

    while (offset < bytes.length) {
        if (offset + 8 > bytes.length) {
            throw new Error("Truncated PNG chunk header");
        }
        const length = view.getUint32(offset, false);
        const typeStart = offset + 4;
        const dataStart = typeStart + 4;
        const dataEnd = dataStart + length;
        const crcEnd = dataEnd + 4;
        if (crcEnd > bytes.length) {
            throw new Error("Truncated PNG chunk data or CRC");
        }

        const type = new TextDecoder().decode(bytes.subarray(typeStart, dataStart));
        const data = bytes.slice(dataStart, dataEnd);
        const expectedCrc = view.getUint32(dataEnd, false);
        const crcInput = bytes.subarray(typeStart, dataEnd);
        const actualCrc = crc32(crcInput);
        if (actualCrc !== expectedCrc) {
            throw new Error(`CRC mismatch in chunk "${type}"`);
        }

        chunks.push({ type, data });
        offset = crcEnd;
    }

    return chunks;
}
