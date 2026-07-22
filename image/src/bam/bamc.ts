import zlib from "zlib";

// BAMC layout: char[4] 'BAMC' @0x00, char[4] 'V1  ' @0x04, u32 uncompressedLength @0x08,
// then a zlib stream of a full BAM v1 file.
export function isBamc(bytes: Uint8Array): boolean {
    return bytes[0] === 0x42 && bytes[1] === 0x41 && bytes[2] === 0x4d && bytes[3] === 0x43; // 'BAMC'
}

export function decodeBamc(bytes: Uint8Array): Uint8Array {
    const compressed = bytes.subarray(12);
    return new Uint8Array(zlib.inflateSync(Buffer.from(compressed)));
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
