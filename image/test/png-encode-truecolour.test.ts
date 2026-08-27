import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { encodeIndexedPng, encodeTruecolourPng } from "../src/png/encode.ts";
import { readChunks } from "../src/png/chunk.ts";
import { emptyPalette } from "../src/model/animation.ts";

function chunk(bytes: Uint8Array, type: string): Uint8Array {
    const found = readChunks(bytes).find((c) => c.type === type);
    if (found === undefined) throw new Error(`expected a ${type} chunk`);
    return found.data;
}

/** Inflate the IDAT and strip the per-scanline filter byte, which the encoder always writes as 0. */
function decodedScanlines(png: Uint8Array, width: number, height: number, bytesPerPixel: number): Uint8Array {
    const raw = new Uint8Array(zlib.inflateSync(Buffer.from(chunk(png, "IDAT"))));
    const stride = 1 + width * bytesPerPixel;
    expect(raw).toHaveLength(height * stride);
    const out = new Uint8Array(width * height * bytesPerPixel);
    for (let row = 0; row < height; row++) {
        expect(raw[row * stride]).toBe(0);
        out.set(raw.subarray(row * stride + 1, (row + 1) * stride), row * width * bytesPerPixel);
    }
    return out;
}

describe("encodeTruecolourPng", () => {
    it("writes colour type 6 with the RGBA bytes it was given", () => {
        const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 9]);

        const png = encodeTruecolourPng(2, 2, rgba);

        // IHDR: width, height, bit depth 8, colour type 6 (truecolour with alpha).
        const ihdr = chunk(png, "IHDR");
        const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
        expect(view.getUint32(0, false)).toBe(2);
        expect(view.getUint32(4, false)).toBe(2);
        expect(ihdr[8]).toBe(8);
        expect(ihdr[9]).toBe(6);
        expect(decodedScanlines(png, 2, 2, 4)).toEqual(rgba);
    });

    it("carries alpha through rather than flattening it", () => {
        // The whole reason a v2 frame cannot go through the indexed encoder: it has real per-pixel
        // alpha, where an indexed PNG can only mark one palette entry transparent.
        const rgba = Uint8Array.from([10, 20, 30, 0, 10, 20, 30, 77]);

        expect([...decodedScanlines(encodeTruecolourPng(2, 1, rgba), 2, 1, 4)]).toEqual([
            10, 20, 30, 0, 10, 20, 30, 77,
        ]);
    });

    it("does not disturb the indexed encoder it shares scanline packing with", () => {
        // encodeIndexedPng keeps writing colour type 3 at one byte per pixel.
        const png = encodeIndexedPng(2, 1, Uint8Array.from([1, 2]), emptyPalette(), 0);

        expect(chunk(png, "IHDR")[9]).toBe(3);
        expect(decodedScanlines(png, 2, 1, 1)).toEqual(Uint8Array.from([1, 2]));
    });
});
