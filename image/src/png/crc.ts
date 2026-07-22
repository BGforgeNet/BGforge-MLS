// Standard PNG/zlib CRC-32 (poly 0xEDB88320, reflected), per the PNG spec Annex D.
const CRC_TABLE = buildTable();

function buildTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        // Uint32Array assignment already performs ToUint32, so storing the raw
        // (possibly signed) `c` yields the same bit pattern as `c >>> 0`.
        table[n] = c;
    }
    return table;
}

export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        const tableIndex = (crc ^ byte) & 0xff;
        crc = (CRC_TABLE[tableIndex] ?? 0) ^ (crc >>> 8);
    }
    // `>>> 0` is unsigned-32-bit coercion (not truncation): the XOR above can produce a
    // signed-negative JS number; Math.trunc would leave it negative, not equivalent.
    return (crc ^ 0xffffffff) >>> 0;
}
