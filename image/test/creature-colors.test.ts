/**
 * The IE creature recolouring a viewer has to do for itself: a creature BAM ships seven placeholder
 * gradients, and the engine overwrites them per creature before drawing. Without this the art renders
 * with green hair and blue armour, which is what is literally in the file.
 */
import { describe, expect, it } from "vitest";
import type { Rgba } from "../src/model/animation.ts";
import { applyCreatureColors, parseGradientTable } from "../src/palette/creature-colors.ts";

/**
 * A 24-bit uncompressed BMP, the shape an install's gradient table ships as. Rows are given top-down
 * and written bottom-up (positive height), which is how the real file stores them.
 */
function gradientBmp(rows: [number, number, number][][]): Uint8Array {
    const width = rows[0]?.length ?? 0;
    const stride = Math.ceil((width * 3) / 4) * 4;
    const pixelOffset = 54;
    const bytes = new Uint8Array(pixelOffset + stride * rows.length);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    view.setUint32(2, bytes.length, true);
    view.setUint32(10, pixelOffset, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, rows.length, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    for (const [y, row] of rows.entries()) {
        const base = pixelOffset + (rows.length - 1 - y) * stride;
        for (const [x, [r, g, b]] of row.entries()) {
            bytes[base + x * 3] = b;
            bytes[base + x * 3 + 1] = g;
            bytes[base + x * 3 + 2] = r;
        }
    }
    return bytes;
}

/** A gradient whose every entry is identifiable by one number, so a test can say where it landed. */
function gradient(tag: number): Rgba[] {
    return Array.from({ length: 12 }, (_, i) => ({ r: tag, g: i, b: 0, a: 255 }));
}

/** 256 entries of a sentinel no gradient produces, so any untouched slot is visible. */
function blankPalette(): Rgba[] {
    return Array.from({ length: 256 }, () => ({ r: 99, g: 99, b: 99, a: 255 }));
}

const table = Array.from({ length: 8 }, (_, i) => gradient(i));

describe("applyCreatureColors", () => {
    it("fills each of the seven ranges from the gradient row its index selects", () => {
        const out = applyCreatureColors(blankPalette(), table, {
            metal: 1,
            minor: 2,
            major: 3,
            skin: 4,
            leather: 5,
            armor: 6,
            hair: 7,
        });
        // The ranges are 12 entries each, running from 0x04.
        const starts = [0x04, 0x10, 0x1c, 0x28, 0x34, 0x40, 0x4c];
        for (const [range, start] of starts.entries()) {
            const tag = range + 1;
            for (let i = 0; i < 12; i++) {
                expect(out[start + i], `range ${range} entry ${i}`).toEqual({ r: tag, g: i, b: 0, a: 255 });
            }
        }
    });

    it("propagates the ranges into the upper palette the engine mirrors them into", () => {
        const out = applyCreatureColors(blankPalette(), table, {
            metal: 1,
            minor: 2,
            major: 3,
            skin: 4,
            leather: 5,
            armor: 6,
            hair: 7,
        });
        // Each upper block takes 8 entries starting one INTO the source range, skipping its brightest.
        const expectBlock = (at: number, tag: number) => {
            for (let i = 0; i < 8; i++) {
                expect(out[at + i], `block 0x${at.toString(16)} entry ${i}`).toEqual({
                    r: tag,
                    g: i + 1,
                    b: 0,
                    a: 255,
                });
            }
        };
        expectBlock(0x58, 2); // minor
        expectBlock(0x60, 3); // major
        expectBlock(0x68, 2); // minor
        expectBlock(0x70, 1); // metal
        expectBlock(0x78, 5); // leather
        expectBlock(0x80, 5); // leather
        expectBlock(0x88, 2); // minor
        for (let at = 0x90; at < 0xa8; at += 8) expectBlock(at, 5); // leather
        expectBlock(0xb0, 4); // skin
        for (let at = 0xb8; at < 0x100; at += 8) expectBlock(at, 5); // leather
        // 0xa8-0xaf is deliberately left alone - no block covers it.
        expect(out[0xa8]).toEqual({ r: 99, g: 99, b: 99, a: 255 });
    });

    it("forces the shadow slot to opaque black and leaves the transparent slot alone", () => {
        const palette = blankPalette();
        palette[0] = { r: 0, g: 255, b: 0, a: 255 };
        const out = applyCreatureColors(palette, table, {
            metal: 1,
            minor: 2,
            major: 3,
            skin: 4,
            leather: 5,
            armor: 6,
            hair: 7,
        });
        expect(out[1]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
        expect(out[0]).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    });

    it("falls back to the first gradient when an index is past the end of the table", () => {
        const out = applyCreatureColors(blankPalette(), table, {
            metal: 200,
            minor: 2,
            major: 3,
            skin: 4,
            leather: 5,
            armor: 6,
            hair: 7,
        });
        expect(out[0x04]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });

    it("leaves the ranges as the file had them when the install supplied no gradients", () => {
        // An install whose gradient table is missing or unreadable: showing the placeholders is right,
        // inventing a recolour from nothing is not.
        const out = applyCreatureColors(blankPalette(), [], {
            metal: 1,
            minor: 2,
            major: 3,
            skin: 4,
            leather: 5,
            armor: 6,
            hair: 7,
        });
        expect(out[0x04]).toEqual({ r: 99, g: 99, b: 99, a: 255 });
        expect(out[0x4c]).toEqual({ r: 99, g: 99, b: 99, a: 255 });
    });

    it("leaves the palette it was given untouched", () => {
        const palette = blankPalette();
        applyCreatureColors(palette, table, {
            metal: 1,
            minor: 2,
            major: 3,
            skin: 4,
            leather: 5,
            armor: 6,
            hair: 7,
        });
        expect(palette[0x04]).toEqual({ r: 99, g: 99, b: 99, a: 255 });
    });
});

describe("parseGradientTable", () => {
    const row = (tag: number): [number, number, number][] =>
        Array.from({ length: 12 }, (_, i) => [tag, i, 0] as [number, number, number]);

    it("reads one gradient per image row, top row first", () => {
        const parsed = parseGradientTable(gradientBmp([row(10), row(20), row(30)]));
        expect(parsed).toHaveLength(3);
        expect(parsed[0]?.[0]).toEqual({ r: 10, g: 0, b: 0, a: 255 });
        expect(parsed[1]?.[5]).toEqual({ r: 20, g: 5, b: 0, a: 255 });
        expect(parsed[2]?.[11]).toEqual({ r: 30, g: 11, b: 0, a: 255 });
        expect(parsed[0]).toHaveLength(12);
    });

    it("keeps only the twelve columns a range consumes, however wide the image is", () => {
        const wide = (tag: number): [number, number, number][] =>
            Array.from({ length: 16 }, (_, i) => [tag, i, 0] as [number, number, number]);
        const parsed = parseGradientTable(gradientBmp([wide(7)]));
        expect(parsed[0]).toHaveLength(12);
        expect(parsed[0]?.at(-1)).toEqual({ r: 7, g: 11, b: 0, a: 255 });
    });

    it("refuses an image too narrow to hold a range, rather than padding one", () => {
        const narrow: [number, number, number][] = Array.from({ length: 8 }, () => [1, 2, 3]);
        expect(() => parseGradientTable(gradientBmp([narrow]))).toThrow(/12/);
    });
});
