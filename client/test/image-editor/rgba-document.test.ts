import { describe, expect, it } from "vitest";
import {
    type IndexedAnimation,
    type RgbaAnimation,
    convertToRgba,
    decodeBamV2,
    emptyPalette,
    readBamV2Structure,
    serializeBamV2,
} from "@bgforge/image";
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

/**
 * A v2 animation as an opened document holds one: parsed from real bytes, with the page it was
 * composed from. Built through the real serializer rather than hand-written so the provenance the
 * save path reads is the provenance the parser actually produces.
 */
function openedV2(): { animation: RgbaAnimation; bytes: Uint8Array } {
    const written = serializeBamV2(rgbaAnimation(), { basePage: 4200 });
    const page = written.pages[0];
    if (page === undefined) throw new Error("expected one page");
    const animation = decodeBamV2(readBamV2Structure(written.bam), () => page.bytes, written.bam);
    return { animation, bytes: written.bam };
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
        // renderer reads 4 bytes at a time. Callers convert first; nothing but this guard catches a
        // caller that forgot.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");
        const indexed: IndexedAnimation = {
            palette: emptyPalette(),
            frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 3, 4]), offsetX: 0, offsetY: 0 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam" },
        };

        expect(() => model.replaceSequences(indexed, "replace")).toThrow(/colour model/);
    });

    it("takes an indexed import once it has been converted, resolving its palette into pixels", () => {
        // The path the editor actually uses: an indexed PNG directory imported into a v2 document
        // converts on the way in, which is exact - every index has one colour.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");
        const palette = emptyPalette();
        palette[1] = { r: 7, g: 8, b: 9, a: 255 };
        const indexed: IndexedAnimation = {
            palette,
            frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 1, 1, 1]), offsetX: 0, offsetY: 0 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };

        model.replaceSequences(convertToRgba(indexed), "replace");

        const frame = model.toView().frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([...decodeFramePixels(frame.pixels).subarray(0, 4)]).toEqual([7, 8, 9, 255]);
    });

    it("saves an untouched v2 back byte-for-byte, rewriting none of its pages", () => {
        // Block compression is lossy, so a save that re-encoded the pages would degrade the file a
        // little every time it was opened and saved. The zero-page assertion is what pins that.
        const { animation, bytes } = openedV2();
        const model = ImageDocumentModel.fromRgbaAnimation(animation, "MAPICONS.BAM");

        const saved = model.saveArtifacts();

        expect(saved.pages).toEqual([]);
        expect(saved.bytes).toEqual(bytes);
    });

    it("names the page numbering it needs when a v2 has no pages of its own to reuse", () => {
        // Reachable once frames can be imported into a v2: the repack needs a page number, and
        // guessing one risks colliding with a page inside a BIF.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        expect(() => model.saveArtifacts()).toThrow(/basePage/);
    });

    it("keeps the frame's centre offsets, which v2 stores exactly as v1 does", () => {
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        const frame = model.toView().frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([frame.offsetX, frame.offsetY]).toEqual([1, 1]);
    });
});
