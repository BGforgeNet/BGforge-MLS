import { expect, test } from "vitest";
import type { Rgba } from "@bgforge/image";
import { frameToRgba } from "../../src/image-editor/webview/render/indexed-to-rgba";

test("frameToRgba maps indices to palette RGBA and makes the transparent index alpha 0", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: i, g: 0, b: 0, a: 255 }));
    const frame = { width: 2, height: 1, pixels: Uint8Array.from([0, 5]), offsetX: 0, offsetY: 0 };
    const rgba = frameToRgba(frame, palette, 0);
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0, 0, 0, 0]); // index 0 = transparent -> a0
    expect([rgba[4], rgba[5], rgba[6], rgba[7]]).toEqual([5, 0, 0, 255]); // index 5 opaque
});

test("frameToRgba returns a buffer of length width*height*4", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
    const frame = { width: 3, height: 2, pixels: Uint8Array.from([1, 2, 3, 4, 5, 6]), offsetX: 0, offsetY: 0 };
    const rgba = frameToRgba(frame, palette, 0);
    expect(rgba).toHaveLength(3 * 2 * 4);
});

test("frameToRgba resolves the last pixel of a multi-pixel frame against its own palette entry", () => {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: 0, g: 0, b: i, a: 255 }));
    const frame = { width: 2, height: 2, pixels: Uint8Array.from([10, 20, 30, 255]), offsetX: 0, offsetY: 0 };
    const rgba = frameToRgba(frame, palette, 0);
    expect([rgba[12], rgba[13], rgba[14], rgba[15]]).toEqual([0, 0, 255, 255]); // last pixel, index 255
});
