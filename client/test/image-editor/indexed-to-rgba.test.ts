import { expect, test } from "vitest";
import type { Rgba } from "@bgforge/image";
import { frameToRgba, rgbaFrameToRgba } from "../../src/image-editor/webview/render/indexed-to-rgba";

test("frameToRgba maps indices to palette RGBA and makes the transparent index alpha 0", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: i, g: 0, b: 0, a: 255 }));
    const pixels = Uint8Array.from([0, 5]);
    const rgba = frameToRgba(pixels, 2, 1, palette, 0);
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0, 0, 0, 0]); // index 0 = transparent -> a0
    expect([rgba[4], rgba[5], rgba[6], rgba[7]]).toEqual([5, 0, 0, 255]); // index 5 opaque
});

test("frameToRgba keeps the transparent pixel's palette rgb, only forcing alpha 0 (not black-baked)", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    palette[0] = { r: 12, g: 34, b: 56, a: 255 };
    const pixels = Uint8Array.from([0]);
    const rgba = frameToRgba(pixels, 1, 1, palette, 0);
    // rgb comes from palette[0], alpha is forced to 0 - a black-baked bug would give [0,0,0,0].
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([12, 34, 56, 0]);
});

test("frameToRgba returns a buffer of length width*height*4", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
    const pixels = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const rgba = frameToRgba(pixels, 3, 2, palette, 0);
    expect(rgba).toHaveLength(3 * 2 * 4);
});

test("frameToRgba resolves the last pixel of a multi-pixel frame against its own palette entry", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: 0, g: 0, b: i, a: 255 }));
    const pixels = Uint8Array.from([10, 20, 30, 255]);
    const rgba = frameToRgba(pixels, 2, 2, palette, 0);
    expect([rgba[12], rgba[13], rgba[14], rgba[15]]).toEqual([0, 0, 255, 255]); // last pixel, index 255
});

test("a true-colour frame's pixels pass through unchanged, alpha included", () => {
    // No palette lookup and no transparent-index rule: a v2 frame already carries per-pixel alpha,
    // and reinterpreting it through the indexed path would read every quad as four separate pixels.
    const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 0, 1, 2, 3, 128]);

    expect([...rgbaFrameToRgba(pixels)]).toEqual([255, 0, 0, 255, 0, 255, 0, 0, 1, 2, 3, 128]);
});
