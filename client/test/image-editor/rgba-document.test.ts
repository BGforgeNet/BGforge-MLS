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
import { decodeBackup, encodeBackup } from "../../src/image-editor/backup";
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

    it("names the page numbering it needs when a v2 has no pages of its own and none was chosen", () => {
        // The repack needs a page number, and guessing one risks colliding with a page inside a BIF.
        // The provider answers this at the edit (see ensureBasePage); reaching the serializer without
        // an answer means no path asked, which must fail rather than invent one.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        expect(() => model.saveArtifacts()).toThrow(/basePage/);
    });

    it("saves and backs up an imported v2 once a page number has been chosen", () => {
        // The path that was unsaveable: an import replaces the frames with ones no page describes,
        // so every save AND the hot-exit backup went through serializeBamV2 with nothing to allocate
        // from. All three are exercised here because each passes different options.
        const { animation } = openedV2();
        const model = ImageDocumentModel.fromRgbaAnimation(animation, "MAPICONS.BAM");
        const palette = emptyPalette();
        palette[1] = { r: 7, g: 8, b: 9, a: 255 };
        model.replaceSequences(
            convertToRgba({
                palette,
                frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 1, 1, 1]), offsetX: 0, offsetY: 0 }],
                sequences: [{ frameRefs: [0], facing: "none" }],
                meta: { sourceFormat: "bam", transparentIndex: 0 },
            }),
            "replace",
        );
        model.setBasePage(4200);

        const inPlace = model.saveArtifacts();
        const saveAs = model.saveArtifacts({ standalone: true });
        const backup = model.backup();

        // A repack writes pages on every path, in-place included: the frames are no longer the
        // file's own, so the pages on disk no longer describe them.
        expect(inPlace.pages.map((p) => p.page)).toEqual([4200]);
        expect(saveAs.pages.map((p) => p.page)).toEqual([4200]);
        expect(backup.pages?.map((p) => p.page)).toEqual([4200]);
    });

    it("round-trips an imported v2 through a backup, pages and all", () => {
        // A v2's frames live outside the .bam, so a backup carrying only the .bam would restore to
        // pages that were never written - the pre-edit picture at best, nothing at all at worst.
        const { animation } = openedV2();
        const model = ImageDocumentModel.fromRgbaAnimation(animation, "MAPICONS.BAM");
        const palette = emptyPalette();
        // Exact in RGB565 (r/b multiples of 8, g of 4), so the assertion pins where the pixels came
        // from rather than absorbing the block codec's rounding - a backup repacks through BC3, and
        // a tolerance here would hide a restore that read the wrong page.
        palette[1] = { r: 16, g: 20, b: 24, a: 255 };
        model.replaceSequences(
            convertToRgba({
                palette,
                frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 1, 1, 1]), offsetX: 0, offsetY: 0 }],
                sequences: [{ frameRefs: [0], facing: "none" }],
                meta: { sourceFormat: "bam", transparentIndex: 0 },
            }),
            "replace",
        );
        model.setBasePage(4200);

        const restored = ImageDocumentModel.fromBackup(decodeBackup(encodeBackup(model.backup())), "MAPICONS.BAM");

        // The decoded pixel, not the frame count: a restore that resolved pages from the wrong place
        // still produces a frame, it just produces the pre-edit one (red, from openedV2's fixture).
        const frame = restored.toView().frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([...decodeFramePixels(frame.pixels).subarray(0, 4)]).toEqual([16, 20, 24, 255]);
    });

    it("applies a playback-rate edit to a true-colour document without calling it a document change", () => {
        // The FPS control is offered for every format. A v2 stores no frame rate, so the edit must
        // reach the view (playback follows it) while reporting false, which is what keeps the host
        // from marking the file dirty for a change no save can write.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        const persisted = model.applyMetaPatch({ fps: 24 });

        expect(model.toView().meta.fps).toBe(24);
        expect(persisted).toBe(false);
    });

    it("leaves a non-persisting edit out of the undo stack", () => {
        // An orphaned snapshot would be popped by a later undo of some other edit, silently
        // reverting the playback rate alongside it.
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");
        model.applyMetaPatch({ fps: 24 });

        model.undo();

        expect(model.toView().meta.fps).toBe(24);
    });

    it("keeps the frame's centre offsets, which v2 stores exactly as v1 does", () => {
        const model = ImageDocumentModel.fromRgbaAnimation(rgbaAnimation(), "MAPICONS.BAM");

        const frame = model.toView().frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([frame.offsetX, frame.offsetY]).toEqual([1, 1]);
    });
});
