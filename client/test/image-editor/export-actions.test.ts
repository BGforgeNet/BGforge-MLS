import { describe, expect, test } from "vitest";
import { DEFAULT_FALLOUT_PALETTE, emptyPalette, loadImage, type Animation } from "@bgforge/image";
import { buildCrossFormatSave, buildExport } from "../../src/image-editor/export-actions";
import { makeMiniFrm } from "./fixtures";

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
    test("FRM -> BAM re-parses as a BAM and reports the dropped fps", () => {
        const { writes, report } = buildCrossFormatSave(makeMiniFrm(), "bam", "/out/x.bam");
        expect(writes).toHaveLength(1);
        const main = writes[0];
        expect(main?.path).toBe("/out/x.bam");
        if (!main) throw new Error("expected a main write");
        const reparsed = loadImage(main.bytes, "x.bam");
        expect(reparsed.meta.sourceFormat).toBe("bam");
        expect(report.has("dropped-fps")).toBe(true);
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
        const bam: Animation = {
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
        const bam: Animation = {
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
