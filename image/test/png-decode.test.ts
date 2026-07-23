import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { emptyPalette } from "@bgforge/image";
import { PNG_SIGNATURE, writeChunk } from "../src/png/chunk.ts";
import { decodeIndexedPng, unfilterScanlines } from "../src/png/decode.ts";
import { encodeIndexedPng } from "../src/png/encode.ts";

function buildIhdr(width: number, height: number, colourType: number): Uint8Array {
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);
    view.setUint32(0, width, false);
    view.setUint32(4, height, false);
    data[8] = 8; // bit depth
    data[9] = colourType;
    data[10] = 0; // compression
    data[11] = 0; // filter
    data[12] = 0; // interlace
    return data;
}

// Builds a valid colour-type-3 PNG from pre-filtered scanlines, so the decoder's
// unfilter step (not the encoder, which only ever writes filter 0) is what runs.
function buildFilteredIndexedPng(width: number, height: number, filteredRows: number[][]): Uint8Array {
    const ihdr = writeChunk("IHDR", buildIhdr(width, height, 3));
    const plte = writeChunk("PLTE", new Uint8Array(256 * 3));
    const trns = writeChunk("tRNS", new Uint8Array([255]));
    const raw = new Uint8Array(height * (1 + width));
    for (const [row, filteredRow] of filteredRows.entries()) {
        raw.set(filteredRow, row * (1 + width));
    }
    const idat = writeChunk("IDAT", new Uint8Array(zlib.deflateSync(Buffer.from(raw))));
    const iend = writeChunk("IEND", new Uint8Array(0));
    const parts = [PNG_SIGNATURE, ihdr, plte, trns, idat, iend];
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

describe("decodeIndexedPng", () => {
    it("round-trips an encoded indexed PNG (indices + palette exact)", () => {
        const pal = emptyPalette();
        pal[3] = { r: 9, g: 8, b: 7, a: 255 };
        const pixels = new Uint8Array([0, 3, 3, 0, 3, 0]); // 3x2
        const out = decodeIndexedPng(encodeIndexedPng(3, 2, pixels, pal, 0));
        expect(out.width).toBe(3);
        expect(out.height).toBe(2);
        expect([...out.pixels]).toEqual([0, 3, 3, 0, 3, 0]);
        expect(out.palette[3]).toEqual({ r: 9, g: 8, b: 7, a: 255 });
        expect(out.transparentIndex).toBe(0);
    });

    it("rejects a non-indexed PNG with a clear message", () => {
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...writeChunk("IHDR", buildIhdr(1, 1, 2))]);
        expect(() => decodeIndexedPng(bytes)).toThrow(/indexed/);
    });

    it("unfilters filter type 1 (Sub)", () => {
        // Original 3x2 indices: [1,2,3] / [4,5,6]. Sub filter subtracts the left
        // neighbour (0 at column 0), so column >0 bytes are nonzero deltas.
        const filteredRows = [
            [1, 1, 1, 1], // filter byte 1, then [1-0, 2-1, 3-2]
            [1, 4, 1, 1], // filter byte 1, then [4-0, 5-4, 6-5]
        ];
        const png = buildFilteredIndexedPng(3, 2, filteredRows);
        const out = decodeIndexedPng(png);
        expect([...out.pixels]).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("unfilters filter type 2 (Up)", () => {
        // Original 2x3 indices: [10,20] / [15,25] / [12,22]. Up filter subtracts
        // the pixel directly above (0 for row 0), wrapping mod 256.
        const filteredRows = [
            [2, 10, 20], // row0 - 0
            [2, 5, 5], // row1 - row0
            [2, 253, 253], // row2 - row1, (12-15) mod 256 = 253
        ];
        const png = buildFilteredIndexedPng(2, 3, filteredRows);
        const out = decodeIndexedPng(png);
        expect([...out.pixels]).toEqual([10, 20, 15, 25, 12, 22]);
    });

    it("unfilters filter type 3 (Average)", () => {
        // Original 3x2 indices: [8,16,24] / [9,17,30]. Average filter subtracts
        // floor((left+above)/2) using original neighbour values.
        const filteredRows = [
            [3, 8, 12, 16], // floor((0+0)/2)=0, floor((8+0)/2)=4, floor((16+0)/2)=8
            [3, 5, 5, 10], // floor((0+8)/2)=4, floor((9+16)/2)=12, floor((17+24)/2)=20
        ];
        const png = buildFilteredIndexedPng(3, 2, filteredRows);
        const out = decodeIndexedPng(png);
        expect([...out.pixels]).toEqual([8, 16, 24, 9, 17, 30]);
    });

    it("unfilters filter type 4 (Paeth)", () => {
        // Original 3x2 indices: [5,10,15] / [6,60,20]. Paeth predictor picks
        // among left/above/above-left; row1 exercises all three neighbours nonzero.
        const filteredRows = [
            [4, 5, 5, 5], // row0: predictor always resolves to `a` (no row above)
            [4, 1, 50, 216], // row1: predictor picks b, b, a in turn (216 = (20-60) mod 256)
        ];
        const png = buildFilteredIndexedPng(3, 2, filteredRows);
        const out = decodeIndexedPng(png);
        expect([...out.pixels]).toEqual([5, 10, 15, 6, 60, 20]);
    });

    it("throws when the IHDR chunk is missing", () => {
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...writeChunk("IEND", new Uint8Array(0))]);
        expect(() => decodeIndexedPng(bytes)).toThrow(/missing IHDR chunk/);
    });

    it("throws on a truncated IHDR chunk", () => {
        // Only 8 bytes: width+height, no bit depth/colour type byte.
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...writeChunk("IHDR", new Uint8Array(8))]);
        expect(() => decodeIndexedPng(bytes)).toThrow(/truncated IHDR chunk/);
    });

    it("rejects a colour-type-3 PNG with a non-8-bit depth", () => {
        const ihdrData = buildIhdr(1, 1, 3);
        ihdrData[8] = 4; // real 4-bit-depth indexed PNGs exist in the wild
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...writeChunk("IHDR", ihdrData)]);
        expect(() => decodeIndexedPng(bytes)).toThrow(/indexed/);
    });

    it("rejects implausible IHDR dimensions before allocating", () => {
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...writeChunk("IHDR", buildIhdr(65536, 65536, 3))]);
        expect(() => decodeIndexedPng(bytes)).toThrow(/implausible image dimensions 65536x65536/);
    });

    it("caps IDAT decompression at the image's expected raw size (zlib-bomb guard)", () => {
        // A 2x2 image whose IDAT inflates to 100 bytes - far past the 2 x (1 + 2) the image needs.
        const ihdr = writeChunk("IHDR", buildIhdr(2, 2, 3));
        const idat = writeChunk("IDAT", new Uint8Array(zlib.deflateSync(Buffer.alloc(100))));
        const iend = writeChunk("IEND", new Uint8Array(0));
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...idat, ...iend]);
        expect(() => decodeIndexedPng(bytes)).toThrow(/IDAT decompression failed/);
    });

    it("tolerates a PNG without PLTE or tRNS chunks (defaults to opaque black)", () => {
        const ihdr = writeChunk("IHDR", buildIhdr(1, 1, 3));
        const raw = new Uint8Array([0, 7]); // filter byte 0, one pixel of index 7
        const idat = writeChunk("IDAT", new Uint8Array(zlib.deflateSync(Buffer.from(raw))));
        const iend = writeChunk("IEND", new Uint8Array(0));
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...idat, ...iend]);

        const out = decodeIndexedPng(bytes);
        expect([...out.pixels]).toEqual([7]);
        expect(out.palette[0]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
        expect(out.transparentIndex).toBe(0);
    });
});

describe("unfilterScanlines", () => {
    it("throws when a scanline's filter-type byte is missing", () => {
        expect(() => unfilterScanlines(new Uint8Array(0), 2, 1)).toThrow(/truncated scanline data/);
    });

    it("throws when a scanline's pixel bytes are missing", () => {
        expect(() => unfilterScanlines(new Uint8Array([0, 1]), 2, 1)).toThrow(/truncated scanline data/);
    });

    it("throws on an unsupported filter type", () => {
        expect(() => unfilterScanlines(new Uint8Array([5, 0]), 1, 1)).toThrow(/unsupported filter type 5/);
    });

    it("Paeth predictor selects the above-left neighbour when it is the closest", () => {
        // Derived so that row1/col1's predictor a=13 (left), b=7 (above), c=10
        // (above-left) satisfy pa=pb=3 > pc=0, landing on the `return c` branch
        // that the other Paeth test (row1: b, b, a) never reaches.
        const raw = new Uint8Array([
            4,
            10,
            253, // row0: decodes to [10, 7]
            4,
            3,
            40, // row1: decodes to [13, 50], col1 predictor picks c=10
        ]);
        const pixels = unfilterScanlines(raw, 2, 2);
        expect([...pixels]).toEqual([10, 7, 13, 50]);
    });
});
