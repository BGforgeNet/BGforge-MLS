import { describe, expect, it } from "vitest";
import { type IndexedAnimation, type RgbaAnimation, emptyPalette } from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { decodeFramePixels } from "../../src/image-editor/webview/messages";

function rgbaAnimation(): RgbaAnimation {
    const pixels = new Uint8Array(2 * 2 * 4);
    pixels.set([255, 0, 0, 255], 0);
    pixels.set([0, 0, 0, 0], 4);
    return {
        colorModel: "rgba",
        frames: [{ width: 2, height: 2, pixels, offsetX: 1, offsetY: 1 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bamv2", fps: 15 },
    };
}

describe("ImageDocumentModel with a true-colour animation", () => {
    it("presents a view marked rgba, carrying no palette", () => {
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        const view = model.toView();

        expect(view.colorModel).toBe("rgba");
        expect(view.sourceFormat).toBe("bamv2");
        // A palette on a true-colour view would be a placeholder nothing reads - and the palette
        // controls key off its presence, so shipping one would offer edits the format cannot hold.
        expect("palette" in view).toBe(false);
    });

    it("sends the frame's RGBA bytes over the wire intact, alpha included", () => {
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        const frame = model.toView().frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        const pixels = decodeFramePixels(frame.pixels);

        expect(pixels).toHaveLength(2 * 2 * 4);
        expect([...pixels.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
    });

    it("refuses to splice indexed frames into a true-colour document", () => {
        // Frame is structurally assignable to RgbaFrame - same fields, minus the optional v1 caches -
        // so this import typechecks and would leave 1-byte-per-pixel frames in an animation the
        // renderer reads 4 bytes at a time. Nothing but this guard catches it.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");
        const indexed: IndexedAnimation = {
            palette: emptyPalette(),
            frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 3, 4]), offsetX: 0, offsetY: 0 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam" },
        };

        expect(() => model.replaceSequences(indexed, "replace")).toThrow(/true-colour/);
    });

    it("keeps the frame's centre offsets, which v2 stores exactly as v1 does", () => {
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        const frame = model.toView().frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([frame.offsetX, frame.offsetY]).toEqual([1, 1]);
    });
});
