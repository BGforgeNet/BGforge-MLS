import { describe, expect, it } from "vitest";
import { type IndexedAnimation, emptyPalette } from "../src/model/animation.ts";
import { convertToRgba } from "../src/convert/to-rgba.ts";

function indexedAnimation(): IndexedAnimation {
    const palette = emptyPalette();
    palette[0] = { r: 0, g: 255, b: 0, a: 255 };
    palette[1] = { r: 255, g: 0, b: 0, a: 255 };
    palette[2] = { r: 12, g: 34, b: 56, a: 255 };
    return {
        palette,
        frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 0, 1]), offsetX: 3, offsetY: -4 }],
        sequences: [{ frameRefs: [0], facing: "NE" }],
        meta: { sourceFormat: "bam", transparentIndex: 0, fps: 15 },
    };
}

describe("convertToRgba", () => {
    it("resolves each index through the palette", () => {
        const { frames } = convertToRgba(indexedAnimation());

        const frame = frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([...frame.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
        expect([...frame.pixels.subarray(4, 8)]).toEqual([12, 34, 56, 255]);
    });

    it("turns the transparent index into a fully transparent pixel, not its palette colour", () => {
        // The palette entry at the transparent index holds a real colour (the games park green
        // there); writing it opaque would paint that green across every transparent pixel.
        const { frames } = convertToRgba(indexedAnimation());

        const frame = frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([...frame.pixels.subarray(8, 12)]).toEqual([0, 0, 0, 0]);
    });

    it("keeps geometry, offsets, cycles and timing, and marks the result true-colour", () => {
        const converted = convertToRgba(indexedAnimation());

        const frame = converted.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([2, 2, 3, -4]);
        expect(converted.sequences).toEqual([{ frameRefs: [0], facing: "NE" }]);
        expect(converted.colorModel).toBe("rgba");
        expect(converted.meta.sourceFormat).toBe("bamv2");
        expect(converted.meta.fps).toBe(15);
    });

    it("carries no provenance, so the result is written as fresh pages rather than reused ones", () => {
        // These frames were never in a PVRZ page. Claiming otherwise would make a save re-emit
        // whatever pages the document happened to hold, with the new pixels silently dropped.
        const converted = convertToRgba(indexedAnimation());

        expect(converted.sourcePages).toBeUndefined();
        expect(converted.frames.every((f) => f.sourceBlocks === undefined)).toBe(true);
    });
});
