import { describe, expect, test } from "vitest";
import {
    DEFAULT_FALLOUT_PALETTE,
    decodeTruecolourPng,
    emptyPalette,
    loadImage,
    type IndexedAnimation,
    type RgbaAnimation,
} from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { buildCrossFormatSave, buildExport } from "../../src/image-editor/export-actions";
import { makeMiniFrm } from "./fixtures";

/** A true-colour document, as a BAM v2 opens into one. */
function rgbaModel(quads: readonly (readonly number[])[]): ImageDocumentModel {
    const pixels = new Uint8Array(quads.length * 4);
    quads.forEach((q, i) => pixels.set(q, i * 4));
    const animation: RgbaAnimation = {
        colorModel: "rgba",
        frames: [{ width: quads.length, height: 1, pixels, offsetX: 0, offsetY: 0 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bamv2", fps: 15 },
    };
    return ImageDocumentModel.fromRgbaAnimation(animation, "MAPICONS.BAM");
}

describe("buildExport", () => {
    test("png-directory yields a manifest.json plus per-frame PNGs under destDir", () => {
        const writes = buildExport(makeMiniFrm(), "png-directory", "/out");
        expect(writes.length).toBeGreaterThanOrEqual(1);
        for (const write of writes) expect(write.path.startsWith("/out")).toBe(true);
        expect(writes.some((w) => w.path === "/out/manifest.json")).toBe(true);
    });

    test("apng yields at least one .png write under destDir", () => {
        const writes = buildExport(makeMiniFrm(), "apng", "/out");
        expect(writes.length).toBeGreaterThanOrEqual(1);
        for (const write of writes) {
            expect(write.path.startsWith("/out")).toBe(true);
            expect(write.path.endsWith(".png")).toBe(true);
        }
    });
});

describe("buildCrossFormatSave", () => {
    test("FRM -> BAM re-parses as a BAM with no loss warning (fps is deliberately unreported)", () => {
        const { writes, report } = buildCrossFormatSave(makeMiniFrm(), "bam", "/out/x.bam");
        expect(writes).toHaveLength(1);
        const main = writes[0];
        expect(main?.path).toBe("/out/x.bam");
        if (!main) throw new Error("expected a main write");
        const reparsed = loadImage(main.bytes, "x.bam");
        expect(reparsed.meta.sourceFormat).toBe("bam");
        // The mini FRM's fps-10 drop is deliberately unreported (BAM cannot store a rate), so the
        // whole conversion counts as lossless and the editor shows no warning modal.
        expect(report.lossless).toBe(true);
    });

    test("FRM -> BAMC yields a compressed BAM (same .bam path) that re-parses as sourceFormat bamc", () => {
        const { writes } = buildCrossFormatSave(makeMiniFrm(), "bamc", "/out/x.bam");
        expect(writes).toHaveLength(1);
        const main = writes[0];
        if (!main) throw new Error("expected a main write");
        expect(main.path).toBe("/out/x.bam");
        expect(loadImage(main.bytes, "x.bam").meta.sourceFormat).toBe("bamc");
    });

    test("BAM -> FRM with a losslessly-remappable palette needs no .pal sidecar", () => {
        const bam: IndexedAnimation = {
            palette: emptyPalette(),
            sequences: [{ frameRefs: [0], facing: "none" }],
            frames: [{ width: 1, height: 1, pixels: Uint8Array.from([0]), offsetX: 0, offsetY: 0 }],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
        const { writes, report } = buildCrossFormatSave(bam, "frm", "/out/y.frm");
        expect(writes).toHaveLength(1);
        expect(writes[0]?.path).toBe("/out/y.frm");
        expect(report.has("palette-remapped-to-default")).toBe(true);
    });

    test("BAM -> FRM with a non-remappable palette adds a .pal sidecar", () => {
        const palette = emptyPalette();
        palette[1] = { r: 123, g: 45, b: 67, a: 255 };
        const bam: IndexedAnimation = {
            palette,
            sequences: [{ frameRefs: [0], facing: "none" }],
            frames: [{ width: 1, height: 1, pixels: Uint8Array.from([1]), offsetX: 0, offsetY: 0 }],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
        const { writes, report } = buildCrossFormatSave(bam, "frm", "/out/y.frm");
        expect(writes).toHaveLength(2);
        expect(writes[0]?.path).toBe("/out/y.frm");
        expect(writes[1]?.path).toBe("/out/y.pal");
        expect(report.has("palette-sidecar-required")).toBe(true);
        expect(DEFAULT_FALLOUT_PALETTE).not.toEqual(palette);
    });
});

describe("exporting a true-colour document to an indexed format", () => {
    test("BAM v2 -> BAM carries the colours through to the written file", () => {
        // The observable is the decoded pixel, not the palette: a right-looking palette with the
        // wrong index per pixel produces a file that opens to garbage.
        const model = rgbaModel([
            [255, 0, 0, 255],
            [0, 128, 255, 255],
        ]);

        const { animation, report: conversion } = model.indexedForExport({ target: "bam" });
        const { writes, report } = buildCrossFormatSave(animation, "bam", "/out/x.bam");
        const main = writes[0];
        if (!main) throw new Error("expected a main write");

        const reparsed = loadImage(main.bytes, "x.bam");
        if (reparsed.colorModel === "rgba") throw new Error("a BAM v1 must re-parse as indexed");
        const frame = reparsed.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect(reparsed.palette[frame.pixels[0] ?? 0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
        expect(reparsed.palette[frame.pixels[1] ?? 0]).toEqual({ r: 0, g: 128, b: 255, a: 255 });
        // Two colours in a 256-slot palette: nothing was lost, so the editor must not warn.
        expect(conversion.lossless).toBe(true);
        expect(report.lossless).toBe(true);
    });

    test("BAM v2 -> FRM (nearest) lands on the bundled palette and says the colours moved", () => {
        // FRM carries no palette of its own in this mode, so every colour has to move to whatever
        // the bundled Fallout palette has - the case the user must be told about.
        const model = rgbaModel([[254, 253, 252, 255]]);

        const { animation, report } = model.indexedForExport({
            target: "frm",
            palette: DEFAULT_FALLOUT_PALETTE,
        });

        expect(animation.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        expect(report.has("colours-quantized")).toBe(true);
        expect(report.lossless).toBe(false);
    });

    test("a true-colour document exports PNGs that keep its alpha, with no quantizing on the way", () => {
        // The reason APNG and PNG-directory bypass indexedForExport entirely: PNG holds per-pixel
        // alpha, so the lossless path stays lossless.
        const model = rgbaModel([
            [255, 0, 0, 255],
            [0, 128, 255, 64],
        ]);

        const writes = buildExport(model.animation, "png-directory", "/out");

        const frame = writes.find((w) => w.path.endsWith("000.png"));
        if (!frame) throw new Error("expected a frame PNG");
        const decoded = decodeTruecolourPng(frame.bytes);
        expect([...decoded.pixels.subarray(4, 8)]).toEqual([0, 128, 255, 64]);
    });

    test("an indexed document comes back with its ACTIVE palette, not the placeholder", () => {
        // An FRM's own palette is all black; exporting the raw one writes a black silhouette.
        const model = ImageDocumentModel.fromAnimation(makeMiniFrm(), "hero.frm");

        const { animation, report } = model.indexedForExport({ target: "bam" });

        expect(animation.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        expect(report.lossless).toBe(true);
    });
});
