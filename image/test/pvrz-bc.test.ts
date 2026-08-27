import { describe, expect, it } from "vitest";
import { decodeBc1, decodeBc3, encodeBc1, encodeBc3 } from "../src/pvrz/bc.ts";

/**
 * A BC1 block is 8 bytes: two RGB565 endpoints little-endian, then 16 two-bit indices packed
 * row-major, four per byte, pixel 0 in the low bits.
 */
function bc1Block(c0: number, c1: number, indices: readonly number[]): Uint8Array {
    const block = new Uint8Array(8);
    new DataView(block.buffer).setUint16(0, c0, true);
    new DataView(block.buffer).setUint16(2, c1, true);
    for (let i = 0; i < 16; i++) {
        const byte = 4 + (i >> 2);
        block[byte] = (block[byte] ?? 0) | ((indices[i] ?? 0) << ((i % 4) * 2));
    }
    return block;
}

const RED565 = 0xf800; // r=31, g=0, b=0
const BLACK565 = 0x0000;

function pixel(rgba: Uint8Array, i: number): number[] {
    return [rgba[i * 4] ?? -1, rgba[i * 4 + 1] ?? -1, rgba[i * 4 + 2] ?? -1, rgba[i * 4 + 3] ?? -1];
}

describe("decodeBc1", () => {
    it("expands an all-index-0 block to the first endpoint across all 16 pixels", () => {
        // c0 > c1 selects the four-colour opaque mode; every index 0 means every pixel is c0.
        const rgba = decodeBc1(
            bc1Block(
                RED565,
                BLACK565,
                Array.from({ length: 16 }, () => 0),
            ),
            4,
            4,
        );

        expect(rgba).toHaveLength(4 * 4 * 4);
        for (let i = 0; i < 16; i++) expect(pixel(rgba, i)).toEqual([255, 0, 0, 255]);
    });

    it("interpolates one midpoint and makes index 3 transparent when c0 <= c1", () => {
        // c0 <= c1 selects the three-colour mode: index 2 is the halfway blend and index 3 is
        // transparent black. The corpus cannot be relied on to contain both orderings, so this
        // block is synthetic.
        const indices = [0, 1, 2, 3, ...Array.from({ length: 12 }, () => 0)];
        const rgba = decodeBc1(bc1Block(BLACK565, RED565, indices), 4, 4);

        expect(pixel(rgba, 0)).toEqual([0, 0, 0, 255]);
        expect(pixel(rgba, 1)).toEqual([255, 0, 0, 255]);
        expect(pixel(rgba, 2)).toEqual([128, 0, 0, 255]);
        expect(pixel(rgba, 3)).toEqual([0, 0, 0, 0]);
    });
});

/**
 * A BC3 block is 16 bytes: an 8-byte alpha block (two endpoints then 16 three-bit indices packed
 * little-endian across six bytes) followed by an 8-byte BC1-shaped colour block.
 */
function bc3Block(
    a0: number,
    a1: number,
    alphaIndices: readonly number[],
    c0: number,
    c1: number,
    colourIndices: readonly number[],
): Uint8Array {
    const block = new Uint8Array(16);
    block[0] = a0;
    block[1] = a1;
    let bits = 0n;
    for (let i = 0; i < 16; i++) bits |= BigInt((alphaIndices[i] ?? 0) & 0x7) << BigInt(i * 3);
    for (let k = 0; k < 6; k++) block[2 + k] = Number((bits >> BigInt(k * 8)) & 0xffn);
    block.set(bc1Block(c0, c1, colourIndices), 8);
    return block;
}

describe("decodeBc3", () => {
    it("maps alpha through the eight-step ramp when a0 > a1, keeping colour from the BC1 block", () => {
        // a0 > a1 selects the eight-value ramp: index 0 is a0, index 1 is a1, index 2 is the first
        // interpolated step (6*a0 + a1)/7.
        const alphaIndices = [0, 1, 2, ...Array.from({ length: 13 }, () => 0)];
        const rgba = decodeBc3(
            bc3Block(
                255,
                0,
                alphaIndices,
                RED565,
                BLACK565,
                Array.from({ length: 16 }, () => 0),
            ),
            4,
            4,
        );

        expect(pixel(rgba, 0)).toEqual([255, 0, 0, 255]);
        expect(pixel(rgba, 1)).toEqual([255, 0, 0, 0]);
        expect(pixel(rgba, 2)).toEqual([255, 0, 0, 219]);
    });

    it("uses the six-step ramp plus explicit 0 and 255 when a0 <= a1", () => {
        // a0 <= a1 selects the other ramp: only four interpolated steps, with indices 6 and 7
        // pinned to fully transparent and fully opaque.
        const alphaIndices = [2, 6, 7, ...Array.from({ length: 13 }, () => 0)];
        const rgba = decodeBc3(
            bc3Block(
                0,
                255,
                alphaIndices,
                RED565,
                BLACK565,
                Array.from({ length: 16 }, () => 0),
            ),
            4,
            4,
        );

        expect(pixel(rgba, 0)).toEqual([255, 0, 0, 51]);
        expect(pixel(rgba, 1)).toEqual([255, 0, 0, 0]);
        expect(pixel(rgba, 2)).toEqual([255, 0, 0, 255]);
    });
});

/** Build a `width * height` RGBA buffer from a per-pixel function. */
function rgbaOf(width: number, height: number, at: (i: number) => readonly number[]): Uint8Array {
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const p = at(i);
        out.set([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 255], i * 4);
    }
    return out;
}

/** Largest per-channel difference between two RGBA buffers. */
function maxChannelError(a: Uint8Array, b: Uint8Array): number {
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
    return worst;
}

describe("encodeBc1", () => {
    it("round-trips a uniform block exactly when its colour is representable in RGB565", () => {
        // Pure red is exact in RGB565 (r=31 expands back to 255), so a lossy codec still has no
        // excuse to change it. An error bound would absorb an endpoint-ordering bug here.
        const rgba = rgbaOf(4, 4, () => [255, 0, 0, 255]);

        expect(decodeBc1(encodeBc1(rgba, 4, 4), 4, 4)).toEqual(rgba);
    });

    it("round-trips a texture whose dimensions are not multiples of four", () => {
        // 6x6 still stores 2x2 whole blocks; the pixels past the edge are encoded from clamped
        // reads and dropped on the way back, so the visible 36 must survive unchanged.
        const rgba = rgbaOf(6, 6, () => [255, 0, 0, 255]);

        expect(decodeBc1(encodeBc1(rgba, 6, 6), 6, 6)).toEqual(rgba);
    });

    it("keeps a two-colour block within a small per-channel error", () => {
        const rgba = rgbaOf(4, 4, (i) => (i % 2 === 0 ? [200, 30, 40, 255] : [20, 180, 90, 255]));

        expect(maxChannelError(decodeBc1(encodeBc1(rgba, 4, 4), 4, 4), rgba)).toBeLessThanOrEqual(8);
    });
});

describe("encodeBc3", () => {
    it("round-trips fully opaque and fully transparent alpha exactly", () => {
        // 0 and 255 are endpoints of the ramp whichever ordering is chosen, so both must survive.
        const rgba = rgbaOf(4, 4, (i) => [255, 0, 0, i % 2 === 0 ? 255 : 0]);

        const out = decodeBc3(encodeBc3(rgba, 4, 4), 4, 4);

        for (let i = 0; i < 16; i++) expect(pixel(out, i)[3]).toBe(i % 2 === 0 ? 255 : 0);
    });

    it("keeps intermediate alpha within the bound three-bit indices allow", () => {
        const rgba = rgbaOf(4, 4, (i) => [10, 20, 30, i * 17]);

        // Alpha indices are three bits, so a block spanning the full range has eight levels about
        // 36 apart and a worst-case error of half that. The bound is the format's, not the
        // encoder's: tightening it below ~18 would only be satisfiable by luck.
        expect(maxChannelError(decodeBc3(encodeBc3(rgba, 4, 4), 4, 4), rgba)).toBeLessThanOrEqual(18);
    });
});
