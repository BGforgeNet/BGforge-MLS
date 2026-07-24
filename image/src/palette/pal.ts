import { type Rgba } from "../model/animation.ts";

// Corpus .pal files are 33536 bytes: a 768-byte 256-entry 6-bit RGB table (index 0 held at raw
// 0xff sentinel) followed by 32768 bytes of color-conversion tables this codec ignores.
// parsePal reads only the leading 768 bytes, so a full corpus file is a valid argument.

// Fallout palettes store 6-bit VGA channels (0..63). Scale to 8-bit reversibly:
// 8-bit = (6bit << 2) | (6bit >> 4); the inverse is >> 2. Round-trips the 6-bit source.
function to8(v6: number): number {
    return ((v6 << 2) | (v6 >> 4)) & 0xff;
}
function to6(v8: number): number {
    return v8 >> 2;
}

export function parsePal(bytes: Uint8Array): Rgba[] {
    if (bytes.byteLength < 768) {
        throw new Error(`parsePal: .pal truncated (need 768 bytes for 256 RGB entries, got ${bytes.byteLength})`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const palette: Rgba[] = [];
    for (let i = 0; i < 256; i++) {
        const p = i * 3;
        palette.push({ r: to8(view.getUint8(p)), g: to8(view.getUint8(p + 1)), b: to8(view.getUint8(p + 2)), a: 255 });
    }
    return palette;
}

export function serializePal(palette: Rgba[]): Uint8Array {
    const out = new Uint8Array(768);
    palette.forEach((c, i) => {
        out[i * 3] = to6(c.r);
        out[i * 3 + 1] = to6(c.g);
        out[i * 3 + 2] = to6(c.b);
    });
    return out;
}
