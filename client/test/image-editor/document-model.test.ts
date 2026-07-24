import { describe, expect, test } from "vitest";
import {
    DEFAULT_FALLOUT_PALETTE,
    encodeBamc,
    loadImage,
    parsePal,
    serializeBamV1,
    serializeFrm,
    serializePal,
} from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { makeMiniBam, makeMiniFrm } from "./fixtures";

test("toView trims frames and carries the active palette", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const view = model.toView();
    expect(view.palette).toHaveLength(256);
    expect(view.frames[0]).not.toHaveProperty("rawEncoding");
    expect(view.frames[0]).not.toHaveProperty("rleEncoded");
});

test("resolvedAnimation swaps the FRM all-black placeholder palette for the active one (export fix)", () => {
    // FRM parses to an all-black placeholder palette; exporting THAT gives black-silhouette PNGs. The
    // export path must use resolvedAnimation, whose palette is the real active one (default Fallout here).
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const rawIsAllBlack = model.animation.palette.every((c) => c.r === 0 && c.g === 0 && c.b === 0);
    expect(rawIsAllBlack).toBe(true);
    expect(model.resolvedAnimation().palette).toEqual(DEFAULT_FALLOUT_PALETTE);
    expect(model.resolvedAnimation().palette.some((c) => c.r !== 0 || c.g !== 0 || c.b !== 0)).toBe(true);
});

test("editing the transparent index keeps RLE-parsed frames decodable (cached encodings dropped)", () => {
    // A frame as parseBamV1 produces it: rawEncoding RLE-encoded against transparent index 0
    // ([1, 0, 2] = literal 1, then a 0-run of 3). Prove the fixture matches the real on-disk
    // encoding first: serialize (which writes rawEncoding verbatim) and re-parse.
    const rle = {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        frames: [
            {
                width: 2,
                height: 2,
                pixels: Uint8Array.from([1, 0, 0, 0]),
                offsetX: 0,
                offsetY: 0,
                rawEncoding: Uint8Array.from([1, 0, 2]),
                rleEncoded: true,
            },
        ],
        sequences: [{ frameRefs: [0], facing: "none" as const }],
        meta: { sourceFormat: "bam" as const, transparentIndex: 0 },
    };
    expect([...loadImage(serializeBamV1(rle), "x.bam").frames[0]!.pixels]).toEqual([1, 0, 0, 0]);

    const model = ImageDocumentModel.fromBytes(serializeBamV1(rle), "x.bam");
    model.applyMetaPatch({ transparentIndex: 1 });
    // The header now says transparent=1; the cached RLE stream (encoded under 0) must not be
    // written verbatim beneath it or the file is unreadable.
    const saved = loadImage(model.getBytes(), "x.bam");
    expect(saved.meta.transparentIndex).toBe(1);
    expect([...saved.frames[0]!.pixels]).toEqual([1, 0, 0, 0]);
});

test("applyMetaPatch fires onChange, round-trips through getBytes, and undo restores", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    let changes = 0;
    model.onChange = () => {
        changes++;
    };
    model.applyMetaPatch({ fps: 20 });
    expect(changes).toBe(1);
    expect(loadImage(model.getBytes(), "hero.frm").meta.fps).toBe(20);
    model.undo();
    expect(loadImage(model.getBytes(), "hero.frm").meta.fps).toBe(makeMiniFrm().meta.fps);
});

describe("undo/redo", () => {
    test("undo restores the previous state and redo reapplies the mutation", () => {
        const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
        model.applyMetaPatch({ fps: 15 });
        model.undo();
        expect(model.animation.meta.fps).toBe(makeMiniFrm().meta.fps);
        model.redo();
        expect(model.animation.meta.fps).toBe(15);
    });

    test("a new mutation after undo clears the redo stack", () => {
        const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
        model.applyMetaPatch({ fps: 15 });
        model.undo();
        model.applyMetaPatch({ fps: 25 });
        // The 15-fps snapshot is unreachable now: redo must not resurrect it past the newer edit.
        model.redo();
        expect(model.animation.meta.fps).toBe(25);
    });

    test("undo/redo on an empty stack is a no-op", () => {
        const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
        let changes = 0;
        model.onChange = () => {
            changes++;
        };
        model.undo();
        model.redo();
        expect(changes).toBe(0);
        expect(model.animation.meta.fps).toBe(10);
    });
});

describe("setExternalPalette", () => {
    test("with no sidecar keeps the default palette", () => {
        const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
        model.setExternalPalette(true);
        const view = model.toView();
        expect(view.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        expect(view.externalPaletteActive).toBe(false);
    });

    test("with a sidecar swaps in the sidecar palette when enabled", () => {
        const sidecar = Array.from({ length: 256 }, () => ({ r: 1, g: 2, b: 3, a: 255 }));
        const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm", serializePal(sidecar));
        const view = model.toView();
        expect(view.hasSidecarPal).toBe(true);
        expect(view.externalPaletteActive).toBe(true);
        expect(view.palette[0]).toEqual(parsePal(serializePal(sidecar))[0]);
        model.setExternalPalette(false);
        expect(model.toView().palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        expect(model.toView().externalPaletteActive).toBe(false);
    });
});

test("getBytes for a BAM fixture round-trips as BAM", () => {
    const model = ImageDocumentModel.fromBytes(serializeBamV1(makeMiniBam()), "hero.bam");
    const reloaded = loadImage(model.getBytes(), "hero.bam");
    expect(reloaded.meta.sourceFormat).toBe("bam");
    expect(reloaded.meta.transparentIndex).toBe(0);
});

test("getBytes for a BAMC fixture round-trips through decode", () => {
    const model = ImageDocumentModel.fromBytes(encodeBamc(serializeBamV1(makeMiniBam())), "hero.bam");
    const reloaded = loadImage(model.getBytes(), "hero.bam");
    expect(reloaded.meta.sourceFormat).toBe("bamc");
});

test("sidecarBytes() is undefined for a default-palette FRM", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    expect(model.sidecarBytes()).toBeUndefined();
});

test("sidecarBytes() serializes the active palette when it differs from the default", () => {
    const sidecar = Array.from({ length: 256 }, () => ({ r: 1, g: 2, b: 3, a: 255 }));
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm", serializePal(sidecar));
    const bytes = model.sidecarBytes();
    expect(bytes).toBeDefined();
    expect(parsePal(bytes ?? new Uint8Array(768))[0]).toEqual(parsePal(serializePal(sidecar))[0]);
});

test("sidecarBytes() is always undefined for BAM", () => {
    const model = ImageDocumentModel.fromBytes(serializeBamV1(makeMiniBam()), "hero.bam");
    expect(model.sidecarBytes()).toBeUndefined();
});

test("replaceSequences replace mode swaps frames and sequences wholesale", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const replacement = makeMiniBam();
    model.replaceSequences(replacement, "replace");
    expect(model.animation.frames).toHaveLength(1);
    expect(model.animation.sequences).toEqual(replacement.sequences);
});

test("replaceSequences append mode offsets the incoming frameRefs past the existing pool", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const existingFrameCount = model.animation.frames.length;
    const addition = makeMiniBam();
    model.replaceSequences(addition, "append");
    expect(model.animation.frames).toHaveLength(existingFrameCount + 1);
    expect(model.animation.sequences.at(-1)?.frameRefs).toEqual([existingFrameCount]);
});

test("reload replaces the animation, sidecar, and history", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    model.applyMetaPatch({ fps: 15 });
    const sidecar = Array.from({ length: 256 }, () => ({ r: 4, g: 5, b: 6, a: 255 }));
    model.reload(serializeFrm(makeMiniFrm()), serializePal(sidecar));
    // History is gone with the old document state: undo must not resurrect the pre-reload edit.
    model.undo();
    expect(model.animation.meta.fps).toBe(makeMiniFrm().meta.fps);
    expect(model.toView().hasSidecarPal).toBe(true);
});
