/**
 * The BMP reader, against the variants a real Infinity Engine install actually ships: 4-, 8-, 24- and 32-bit
 * uncompressed, plus 32-bit with channel masks. RLE and the exotic depths are refused rather than guessed at.
 */
import { describe, expect, it } from "vitest";
import { readBmpRgba } from "../src/bmp/parse.ts";

/** A BMP, assembled from its parts so a test can state exactly which variant it is exercising. */
function bmp(input: {
    width: number;
    height: number; // negative for a top-down image
    bpp: number;
    compression?: number;
    palette?: [number, number, number][];
    rows: number[][]; // one array of bytes per row, in file order, before padding
    headerSize?: number;
    masks?: [number, number, number, number];
    /** What the header CLAIMS the palette holds, where that differs from what it carries. */
    declaredColours?: number;
}): Uint8Array {
    const headerSize = input.headerSize ?? 40;
    const palette = input.palette ?? [];
    const paletteBytes = palette.length * 4;
    const stride = Math.ceil(input.rows[0]!.length / 4) * 4;
    // A 40-byte header carries its channel masks in the three DWORDs that follow it, before the pixel data;
    // a longer header has fields of its own for them and adds nothing.
    const maskBytes = input.masks && headerSize === 40 ? 12 : 0;
    const pixelOffset = 14 + headerSize + maskBytes + paletteBytes;
    const out = new Uint8Array(pixelOffset + stride * input.rows.length);
    const view = new DataView(out.buffer);

    out[0] = 0x42; // "B"
    out[1] = 0x4d; // "M"
    view.setUint32(2, out.length, true);
    view.setUint32(10, pixelOffset, true);

    view.setUint32(14, headerSize, true);
    view.setInt32(18, input.width, true);
    view.setInt32(22, input.height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, input.bpp, true);
    view.setUint32(30, input.compression ?? 0, true);
    view.setUint32(46, input.declaredColours ?? palette.length, true);
    if (input.masks) {
        const count = headerSize === 40 ? 3 : 4;
        for (const [i, mask] of input.masks.slice(0, count).entries()) view.setUint32(14 + 40 + i * 4, mask, true);
    }

    for (const [i, [r, g, b]] of palette.entries()) {
        out.set([b, g, r, 0], 14 + headerSize + maskBytes + i * 4);
    }
    for (const [i, row] of input.rows.entries()) out.set(row, pixelOffset + i * stride);
    return out;
}

const RED = 0xff_00_00_ff; // packed as the test reads pixels: r,g,b,a
function pixel(rgba: Uint8Array, x: number, y: number, width: number): number {
    const at = (y * width + x) * 4;
    return ((rgba[at]! << 24) | (rgba[at + 1]! << 16) | (rgba[at + 2]! << 8) | rgba[at + 3]!) >>> 0;
}

describe("readBmpRgba", () => {
    // Bottom-up is the default BMP orientation and the one every shipped IE bitmap uses, so a reader that
    // ignores it returns a vertically mirrored picture with no error anywhere.
    it("reads a bottom-up 24-bit image right way up", () => {
        const image = readBmpRgba(
            bmp({
                width: 2,
                height: 2,
                bpp: 24,
                // File order is bottom row first: the red pixel is at the TOP-left once flipped.
                rows: [
                    [0, 0, 0, 0, 0, 0],
                    [0, 0, 255, 0, 0, 0],
                ],
            }),
        );
        expect([image.width, image.height]).toEqual([2, 2]);
        expect(pixel(image.rgba, 0, 0, 2)).toBe(RED);
        expect(pixel(image.rgba, 0, 1, 2)).toBe(0x00_00_00_ff);
    });

    it("reads a top-down image (negative height) without flipping it", () => {
        const image = readBmpRgba(
            bmp({
                width: 2,
                height: -2,
                bpp: 24,
                rows: [
                    [0, 0, 255, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0],
                ],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 2)).toBe(RED);
    });

    it("resolves 8-bit pixels through the palette", () => {
        const image = readBmpRgba(
            bmp({
                width: 2,
                height: 1,
                bpp: 8,
                palette: [
                    [0, 0, 0],
                    [255, 0, 0],
                ],
                rows: [[1, 0]],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 2)).toBe(RED);
        expect(pixel(image.rgba, 1, 0, 2)).toBe(0x00_00_00_ff);
    });

    // 4bpp is the single most common depth in a shipped install, and its two pixels per byte are exactly
    // where an off-by-one nibble goes unnoticed.
    it("unpacks 4-bit pixels high nibble first", () => {
        const image = readBmpRgba(
            bmp({
                width: 2,
                height: 1,
                bpp: 4,
                palette: [
                    [0, 0, 0],
                    [255, 0, 0],
                ],
                rows: [[0x10]],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 2)).toBe(RED);
        expect(pixel(image.rgba, 1, 0, 2)).toBe(0x00_00_00_ff);
    });

    it("skips the row padding that aligns each row to four bytes", () => {
        const image = readBmpRgba(
            bmp({
                width: 1,
                height: 2,
                bpp: 24,
                rows: [
                    [0, 0, 0],
                    [0, 0, 255],
                ],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 1)).toBe(RED);
    });

    // 32-bit BI_RGB leaves the fourth byte undefined, so reading it as alpha turns a whole opaque image
    // transparent - which is indistinguishable from a decode that produced nothing.
    it("treats an unmasked 32-bit image as opaque", () => {
        const image = readBmpRgba(bmp({ width: 1, height: 1, bpp: 32, rows: [[0, 0, 255, 0]] }));
        expect(pixel(image.rgba, 0, 0, 1)).toBe(RED);
    });

    it("honours the channel masks of a BI_BITFIELDS image", () => {
        const image = readBmpRgba(
            bmp({
                width: 1,
                height: 1,
                bpp: 32,
                compression: 3,
                headerSize: 56,
                // The usual ARGB layout, with four distinct channel values so a swapped pair cannot pass.
                masks: [0x00_ff_00_00, 0x00_00_ff_00, 0x00_00_00_ff, 0xff_00_00_00],
                rows: [[0x33, 0x22, 0x11, 0x80]],
            }),
        );
        // Little-endian pixel 0x80112233: red 0x11, green 0x22, blue 0x33, alpha 0x80.
        expect(pixel(image.rgba, 0, 0, 1)).toBe(0x11_22_33_80);
    });

    // With no alpha mask - a 40-byte header's three masks - the image is opaque rather than transparent.
    it("treats a masked image with no alpha mask as opaque", () => {
        const image = readBmpRgba(
            bmp({
                width: 1,
                height: 1,
                bpp: 32,
                compression: 3,
                masks: [0x00_ff_00_00, 0x00_00_ff_00, 0x00_00_00_ff, 0],
                rows: [[0x33, 0x22, 0x11, 0x00]],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 1)).toBe(0x11_22_33_ff);
    });

    /**
     * A palette count of zero means "as many as the depth allows" - 256 at 8bpp - which a file carrying two
     * entries does not have. The entries it does carry still resolve; the rest stay black rather than
     * reading whatever follows the palette.
     */
    it("reads a palette the header under-declares and over-declares alike", () => {
        const image = readBmpRgba(
            bmp({
                width: 2,
                height: 1,
                bpp: 8,
                declaredColours: 0,
                palette: [
                    [0, 0, 0],
                    [255, 0, 0],
                ],
                rows: [[1, 0]],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 2)).toBe(RED);
    });

    // A mask of zero selects no bits at all. It cannot be scanned for its lowest set bit, so it is answered
    // with a full channel rather than left to a loop with nothing to find.
    it("treats a zero channel mask as fully on", () => {
        const image = readBmpRgba(
            bmp({
                width: 1,
                height: 1,
                bpp: 32,
                compression: 3,
                headerSize: 56,
                masks: [0x00_ff_00_00, 0x00_00_ff_00, 0x00_00_00_ff, 0],
                rows: [[0x33, 0x22, 0x11, 0x00]],
            }),
        );
        expect(pixel(image.rgba, 0, 0, 1)).toBe(0x11_22_33_ff);
    });

    // 1 and 2 bits per pixel would fall through the 4bpp nibble unpack and decode as nonsense, which is worse
    // than no picture: nothing downstream can tell a wrong bitmap from a right one.
    it.each([1, 2, 16])("refuses %ibpp rather than unpacking it wrongly", (bpp) => {
        expect(() => readBmpRgba(bmp({ width: 1, height: 1, bpp, rows: [[0]] }))).toThrow(/bit depth/);
    });

    it("refuses channel masks at a depth they do not describe", () => {
        expect(() =>
            readBmpRgba(bmp({ width: 1, height: 1, bpp: 8, compression: 3, palette: [[0, 0, 0]], rows: [[0]] })),
        ).toThrow(/compression 3 at 8bpp/);
    });

    it("refuses a compression it cannot decode rather than drawing nonsense", () => {
        expect(() => readBmpRgba(bmp({ width: 1, height: 1, bpp: 8, compression: 1, rows: [[0]] }))).toThrow(
            /compression/i,
        );
    });

    it("refuses a file that is not a BMP", () => {
        expect(() => readBmpRgba(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toThrow(/BMP/i);
    });

    it("refuses a header claiming more pixels than any real bitmap holds", () => {
        expect(() => readBmpRgba(bmp({ width: 65535, height: 65535, bpp: 24, rows: [[0, 0, 0]] }))).toThrow(
            /implausibly large/,
        );
    });

    it("refuses a file too short to hold a header", () => {
        const truncated = bmp({ width: 4, height: 4, bpp: 24, rows: [[0, 0, 0]] }).subarray(0, 40);
        expect(() => readBmpRgba(truncated)).toThrow(/BMP/i);
    });

    // A header can name more rows than the file carries. Refused up front rather than per pixel: the read
    // loop would otherwise throw partway through, after allocating the whole output.
    it("refuses a file whose pixel data is shorter than its header claims", () => {
        const short = bmp({ width: 4, height: 4, bpp: 24, rows: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] });
        expect(() => readBmpRgba(short)).toThrow(/past EOF/);
    });

    it("refuses a zero or negative width", () => {
        expect(() => readBmpRgba(bmp({ width: 0, height: 1, bpp: 24, rows: [[0, 0, 0]] }))).toThrow(/dimensions/);
    });
});
