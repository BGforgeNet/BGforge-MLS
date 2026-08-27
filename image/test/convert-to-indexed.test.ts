import { describe, expect, it } from "vitest";
import { type Rgba, type RgbaAnimation } from "../src/model/animation.ts";
import { DEFAULT_FALLOUT_PALETTE } from "../src/palette/default-palette.ts";
import { convertToIndexed } from "../src/convert/to-indexed.ts";

/** A one-frame true-colour animation over the given `width * height` RGBA quadruples. */
function rgbaAnimation(width: number, height: number, quads: readonly (readonly number[])[]): RgbaAnimation {
    const pixels = new Uint8Array(width * height * 4);
    quads.forEach((q, i) => pixels.set(q, i * 4));
    return {
        colorModel: "rgba",
        frames: [{ width, height, pixels, offsetX: 3, offsetY: -4 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bamv2", fps: 15 },
    };
}

/** The colour an indexed pixel resolves to, which is what any viewer of the export will see. */
function colourAt(palette: Rgba[], indices: Uint8Array, at: number): Rgba {
    const colour = palette[indices[at] ?? 0];
    if (colour === undefined) throw new Error("index outside the palette");
    return colour;
}

describe("convertToIndexed", () => {
    it("keeps every colour exactly when the frame fits in a palette", () => {
        const anim = rgbaAnimation(2, 2, [
            [255, 0, 0, 255],
            [0, 255, 128, 255],
            [12, 34, 56, 255],
            [255, 0, 0, 255],
        ]);

        const { animation, report } = convertToIndexed(anim, "bam");

        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect(colourAt(animation.palette, frame.pixels, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
        expect(colourAt(animation.palette, frame.pixels, 1)).toEqual({ r: 0, g: 255, b: 128, a: 255 });
        expect(colourAt(animation.palette, frame.pixels, 2)).toEqual({ r: 12, g: 34, b: 56, a: 255 });
        // Same colour, same index: quantization must not split one colour across two slots.
        expect(frame.pixels[3]).toBe(frame.pixels[0]);
        expect(report.lossless).toBe(true);
    });

    it("puts fully transparent pixels on the transparent index", () => {
        const anim = rgbaAnimation(1, 2, [
            [255, 0, 0, 255],
            [9, 9, 9, 0],
        ]);

        const { animation } = convertToIndexed(anim, "bam");

        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect(frame.pixels[1]).toBe(animation.meta.transparentIndex);
        // An opaque pixel must never land there, or it disappears in the game.
        expect(frame.pixels[0]).not.toBe(animation.meta.transparentIndex);
    });

    it("reports flattening a partly transparent pixel, which no indexed format can hold", () => {
        // The sharper loss of the two: v2 carries 8-bit per-pixel alpha, an indexed format carries
        // one all-or-nothing index, so a soft edge becomes a hard one.
        const anim = rgbaAnimation(1, 2, [
            [255, 0, 0, 255],
            [255, 0, 0, 90],
        ]);

        const { report } = convertToIndexed(anim, "bam");

        expect(report.has("alpha-flattened")).toBe(true);
        expect(report.lossless).toBe(false);
    });

    it("says nothing about alpha when every pixel is fully opaque or fully clear", () => {
        // A guard that fires on a clean conversion trains its reader to dismiss it.
        const anim = rgbaAnimation(1, 2, [
            [255, 0, 0, 255],
            [0, 0, 0, 0],
        ]);

        const { report } = convertToIndexed(anim, "bam");

        expect(report.has("alpha-flattened")).toBe(false);
        expect(report.lossless).toBe(true);
    });

    it("reports the colour loss when the frame carries more colours than a palette holds", () => {
        const quads = Array.from({ length: 400 }, (_, i) => [i % 256, (i * 7) % 256, (i * 13) % 256, 255]);

        const { animation, report } = convertToIndexed(rgbaAnimation(20, 20, quads), "bam");

        expect(report.has("colours-quantized")).toBe(true);
        expect(report.lossless).toBe(false);
        expect(animation.palette).toHaveLength(256);
    });

    it("carries the frame geometry, offsets, sequences and timing across unchanged", () => {
        const anim = rgbaAnimation(2, 2, [[255, 0, 0, 255]]);

        const { animation } = convertToIndexed(anim, "bamc");

        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([2, 2, 3, -4]);
        expect(animation.sequences).toEqual([{ frameRefs: [0], facing: "none" }]);
        expect(animation.meta.sourceFormat).toBe("bamc");
        expect(animation.meta.fps).toBe(15);
    });

    it("maps onto a palette it is given rather than building one", () => {
        // FRM's "nearest match" mode: the file has no palette of its own, so the colours have to
        // land on the bundled Fallout palette, whatever they were.
        const anim = rgbaAnimation(1, 1, [[254, 254, 254, 255]]);

        const { animation, report } = convertToIndexed(anim, "frm", { palette: DEFAULT_FALLOUT_PALETTE });

        expect(animation.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        // Nearest, not exact: the bundled palette has no 254,254,254, and white is what it has.
        expect(colourAt(animation.palette, frame.pixels, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
        expect(report.has("colours-quantized")).toBe(true);
    });
});
