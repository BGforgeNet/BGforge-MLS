import { describe, expect, it } from "vitest";
import { type IndexedAnimation, type RgbaAnimation, emptyPalette, isRgbaAnimation } from "../src/model/animation.ts";

const indexed: IndexedAnimation = {
    palette: emptyPalette(),
    frames: [{ width: 1, height: 1, pixels: Uint8Array.from([0]), offsetX: 0, offsetY: 0 }],
    sequences: [{ frameRefs: [0], facing: "none" }],
    meta: { sourceFormat: "bam" },
};

const rgba: RgbaAnimation = {
    colorModel: "rgba",
    frames: [{ width: 1, height: 1, pixels: Uint8Array.from([1, 2, 3, 4]), offsetX: 0, offsetY: 0 }],
    sequences: [{ frameRefs: [0], facing: "none" }],
    meta: { sourceFormat: "bamv2" },
};

describe("isRgbaAnimation", () => {
    it("separates a true-colour animation from an indexed one", () => {
        expect(isRgbaAnimation(rgba)).toBe(true);
        expect(isRgbaAnimation(indexed)).toBe(false);
    });

    it("narrows to the palette-bearing member so indexed consumers keep their palette", () => {
        // The guard is the one narrowing every consumer shares; if it stopped narrowing, reading
        // `.palette` off the false branch would not compile, which is the point of the union.
        const animation = indexed as IndexedAnimation | RgbaAnimation;

        if (isRgbaAnimation(animation)) throw new Error("expected the indexed member");

        expect(animation.palette).toHaveLength(256);
    });
});
