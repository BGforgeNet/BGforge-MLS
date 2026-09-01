import { describe, expect, it } from "vitest";
import { decodeBc1, decodeBc3, encodeBc3 } from "../src/pvrz/bc.ts";

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

    it("places each block of a multi-block texture at its own position", () => {
        // The block walk scatters 4x4 blocks into a row-major buffer, so a texture of one block
        // cannot tell a correct destination offset from any other. Four blocks, each a distinct
        // solid colour, pin the mapping from block coordinate to pixel coordinate.
        const colours = [RED565, 0x07e0, 0x001f, 0xffff]; // red, green, blue, white
        const expected = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 255, 255],
        ];
        const blocks = new Uint8Array(4 * 8);
        for (const [i, c] of colours.entries()) {
            blocks.set(
                bc1Block(
                    c,
                    BLACK565,
                    Array.from({ length: 16 }, () => 0),
                ),
                i * 8,
            );
        }

        const rgba = decodeBc1(blocks, 8, 8);

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const block = (y >> 2) * 2 + (x >> 2);
                expect(pixel(rgba, y * 8 + x), `pixel ${x},${y}`).toEqual(expected[block]);
            }
        }
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

    it("reads every one of the 16 alpha indices from its own place in the packed 48-bit field", () => {
        // The 16 three-bit indices span six bytes, so an index is addressed by a bit offset of
        // 0, 3, ... 45 - and offset 30 is the one that straddles the 32-bit halfway mark. Existing
        // cases only ever set pixels 0-2, leaving every offset past 6 unpinned; a reader that
        // mis-shifts anywhere above that stays green without this.
        //
        // a0 > a1 selects the eight-value ramp: a0, a1, then six steps of ((7-i)*a0 + i*a1)/7.
        const ramp = [255, 0, 219, 182, 146, 109, 73, 36];
        const alphaIndices = Array.from({ length: 16 }, (_, i) => i % 8);

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

        for (let i = 0; i < 16; i++) expect(pixel(rgba, i)[3], `pixel ${i}`).toBe(ramp[i % 8]);
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

// No encodeBc1 suite: there is no BC1 encoder. The decodeBc1 cases above build their blocks by hand
// rather than through one, and real BC1 pages are decoded by the corpus sweep in pvrz-container.test.ts.

describe("encodeBc3", () => {
    it("round-trips a uniform block exactly when its colour is representable in RGB565", () => {
        // Pure red is exact in RGB565 (r=31 expands back to 255), so a lossy codec still has no
        // excuse to change it. An error bound would absorb an endpoint-ordering bug here.
        const rgba = rgbaOf(4, 4, () => [255, 0, 0, 255]);

        expect(decodeBc3(encodeBc3(rgba, 4, 4), 4, 4)).toEqual(rgba);
    });

    it("round-trips a texture whose dimensions are not multiples of four", () => {
        // 6x6 still stores 2x2 whole blocks; the pixels past the edge are encoded from clamped
        // reads and dropped on the way back, so the visible 36 must survive unchanged.
        const rgba = rgbaOf(6, 6, () => [255, 0, 0, 255]);

        expect(decodeBc3(encodeBc3(rgba, 6, 6), 6, 6)).toEqual(rgba);
    });

    it("keeps a two-colour block within a small per-channel error", () => {
        const rgba = rgbaOf(4, 4, (i) => (i % 2 === 0 ? [200, 30, 40, 255] : [20, 180, 90, 255]));

        expect(maxChannelError(decodeBc3(encodeBc3(rgba, 4, 4), 4, 4), rgba)).toBeLessThanOrEqual(8);
    });

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
