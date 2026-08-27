import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { PNG_SIGNATURE, writeChunk } from "../src/png/chunk.ts";
import { buildIhdr, encodeIndexedPng, encodeTruecolourPng } from "../src/png/encode.ts";
import { decodeTruecolourPng } from "../src/png/decode.ts";
import { emptyPalette } from "../src/model/animation.ts";

/** RGBA bytes for `quads`, in order. */
function pixelsOf(quads: readonly (readonly number[])[]): Uint8Array {
    const out = new Uint8Array(quads.length * 4);
    quads.forEach((q, i) => out.set(q, i * 4));
    return out;
}

/**
 * A colour-type-6 PNG whose scanlines all use `filterType`. The encoder only ever writes filter 0,
 * so a round-trip cannot reach the other four - and a real PNG from any other tool will use them.
 */
function filteredPng(width: number, height: number, rgba: Uint8Array, filterType: number): Uint8Array {
    const stride = width * 4;
    const raw = new Uint8Array(height * (1 + stride));
    for (let row = 0; row < height; row++) {
        const at = row * (1 + stride);
        raw[at] = filterType;
        for (let col = 0; col < stride; col++) {
            const value = rgba[row * stride + col] ?? 0;
            const left = col >= 4 ? (rgba[row * stride + col - 4] ?? 0) : 0;
            const above = row >= 1 ? (rgba[(row - 1) * stride + col] ?? 0) : 0;
            const aboveLeft = row >= 1 && col >= 4 ? (rgba[(row - 1) * stride + col - 4] ?? 0) : 0;
            let predictor: number;
            switch (filterType) {
                case 1:
                    predictor = left;
                    break;
                case 2:
                    predictor = above;
                    break;
                case 3:
                    predictor = Math.floor((left + above) / 2);
                    break;
                case 4: {
                    const p = left + above - aboveLeft;
                    const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - above), Math.abs(p - aboveLeft)];
                    predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : aboveLeft;
                    break;
                }
                default:
                    predictor = 0;
            }
            raw[at + 1 + col] = (value - predictor) & 0xff;
        }
    }
    const parts = [
        PNG_SIGNATURE,
        writeChunk("IHDR", buildIhdr(width, height, 6)),
        writeChunk("IDAT", new Uint8Array(zlib.deflateSync(Buffer.from(raw)))),
        writeChunk("IEND", new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

describe("decodeTruecolourPng", () => {
    it("round-trips what the encoder wrote, per-pixel alpha included", () => {
        // The alpha is the point: it is the one thing an indexed PNG cannot carry, and the reason a
        // true-colour export exists at all.
        const rgba = pixelsOf([
            [255, 0, 0, 255],
            [0, 128, 255, 64],
            [1, 2, 3, 0],
            [9, 9, 9, 200],
        ]);

        const decoded = decodeTruecolourPng(encodeTruecolourPng(2, 2, rgba));

        expect([decoded.width, decoded.height]).toEqual([2, 2]);
        expect([...decoded.pixels]).toEqual([...rgba]);
    });

    it.each([1, 2, 3, 4])("unfilters scanlines written with filter type %i", (filterType) => {
        // Four bytes per pixel moves the filter's "left" neighbour four bytes back, not one - the
        // exact place a decoder generalized from the indexed one goes wrong, and silently: the
        // image still decodes, just with smeared colour.
        const rgba = pixelsOf([
            [10, 20, 30, 255],
            [200, 100, 50, 128],
            [7, 7, 7, 7],
            [255, 255, 255, 255],
        ]);

        const decoded = decodeTruecolourPng(filteredPng(2, 2, rgba, filterType));

        expect([...decoded.pixels]).toEqual([...rgba]);
    });

    it("refuses an indexed PNG rather than reading its indices as colour", () => {
        const indexed = encodeIndexedPng(1, 1, Uint8Array.from([0]), emptyPalette(), 0);

        expect(() => decodeTruecolourPng(indexed)).toThrow(/colour type 3/);
    });
});
