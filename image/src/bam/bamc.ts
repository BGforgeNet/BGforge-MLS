import zlib from "zlib";
import { MAX_INFLATED_BYTES } from "../limits.ts";

// BAMC layout: char[4] 'BAMC' @0x00, char[4] 'V1  ' @0x04, u32 uncompressedLength @0x08,
// then a zlib stream of a full BAM v1 file.
export function isBamc(bytes: Uint8Array): boolean {
    return bytes[0] === 0x42 && bytes[1] === 0x41 && bytes[2] === 0x4d && bytes[3] === 0x43; // 'BAMC'
}

export function decodeBamc(bytes: Uint8Array): Uint8Array {
    if (bytes.byteLength < 12) throw new Error("decodeBamc: BAMC header truncated");
    const version = String.fromCodePoint(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
    if (version !== "V1  ") throw new Error(`decodeBamc: unsupported BAMC version "${version.trim()}"`);
    const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0x08, true);
    if (declared > MAX_INFLATED_BYTES) {
        throw new Error(
            `decodeBamc: declared uncompressed size ${declared} exceeds the ${MAX_INFLATED_BYTES}-byte cap`,
        );
    }
    const compressed = bytes.subarray(12);
    try {
        // The declared size doubles as the inflate cap, so a crafted stream cannot out-inflate its
        // own header claim (Math.max keeps a zero claim loud instead of Node treating 0 as no limit).
        return new Uint8Array(zlib.inflateSync(Buffer.from(compressed), { maxOutputLength: Math.max(declared, 1) }));
    } catch (error) {
        throw new Error(`decodeBamc: decompression failed: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
}

export function encodeBamc(bamV1: Uint8Array): Uint8Array {
    const compressed = zlib.deflateSync(Buffer.from(bamV1));
    const out = new Uint8Array(12 + compressed.length);
    const view = new DataView(out.buffer);
    out.set(new TextEncoder().encode("BAMC"), 0x00);
    out.set(new TextEncoder().encode("V1  "), 0x04);
    view.setUint32(0x08, bamV1.length, true);
    out.set(compressed, 12);
    return out;
}
