import path from "path";
import { describe, expect, it } from "vitest";
import { type Animation, LossReport } from "@bgforge/image";
import { needsCyclePick, reshapeImportToFrm, saveAsTargetPath, summarizeLoss } from "../../src/image-editor/save-as";
import { makeMiniBam, makeMiniFrm } from "./fixtures";

function multiCycleBam(cycles: number): Animation {
    const base = makeMiniBam();
    return {
        ...base,
        frames: Array.from({ length: cycles }, (_, i) => ({
            width: 1,
            height: 1,
            pixels: Uint8Array.from([i]),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: Array.from({ length: cycles }, (_, i) => ({ frameRefs: [i], facing: "none" as const })),
    };
}

describe("saveAsTargetPath", () => {
    const src = path.join("mods", "art", "critter.frm");

    it("appends -apng for the APNG directory export", () => {
        expect(saveAsTargetPath(src, "apng")).toBe(path.join("mods", "art", "critter-apng"));
    });

    it("uses the bare basename for the PNG-directory export", () => {
        expect(saveAsTargetPath(src, "png-directory")).toBe(path.join("mods", "art", "critter"));
    });

    it("names single-file targets <base>.<ext>", () => {
        expect(saveAsTargetPath(src, "frm")).toBe(path.join("mods", "art", "critter.frm"));
        expect(saveAsTargetPath(src, "bam")).toBe(path.join("mods", "art", "critter.bam"));
    });

    it("gives BAMC the shared .bam extension", () => {
        expect(saveAsTargetPath(src, "bamc")).toBe(path.join("mods", "art", "critter.bam"));
    });
});

describe("needsCyclePick", () => {
    it("is false for a single non-directional cycle (auto-resolves)", () => {
        expect(needsCyclePick(makeMiniBam())).toBe(false);
    });

    it("is true for a multi-cycle non-directional animation", () => {
        expect(needsCyclePick(multiCycleBam(3))).toBe(true);
    });

    it("is false when the cycle count derives a directional layout", () => {
        expect(needsCyclePick(multiCycleBam(6))).toBe(false);
        expect(needsCyclePick(multiCycleBam(8))).toBe(false);
    });

    it("is false for a facing-tagged animation", () => {
        expect(needsCyclePick(makeMiniFrm())).toBe(false);
    });
});

describe("summarizeLoss", () => {
    it("lists only real losses, not informational notes", () => {
        const report = new LossReport();
        report.add("embedded-palette", "palette embedded directly in the BAM output");
        report.add("dropped-fps", "source fps 10 has no BAM equivalent");
        expect(summarizeLoss(report)).toBe("Converting will lose: source fps 10 has no BAM equivalent");
    });
});

describe("reshapeImportToFrm", () => {
    it("builds a single-orientation FRM from the chosen cycle of a multi-cycle import", () => {
        const reshaped = reshapeImportToFrm(multiCycleBam(3), 2);
        expect(reshaped.meta.sourceFormat).toBe("frm");
        expect(reshaped.sequences).toHaveLength(6);
        // All six rotations share the chosen cycle's frames (the FRM shared-rotation form).
        expect(new Set(reshaped.sequences.map((s) => s.frameRefs.join(","))).size).toBe(1);
        const ref = reshaped.sequences[0]?.frameRefs[0];
        const frame = ref === undefined ? undefined : reshaped.frames[ref];
        if (!frame) throw new Error("missing reshaped frame");
        // The chosen cycle's pixel value survives the nearest-palette remap of an all-black palette.
        expect(frame.pixels).toHaveLength(1);
    });

    it("reshapes a single-cycle import without a cycle pick", () => {
        const reshaped = reshapeImportToFrm(makeMiniBam());
        expect(reshaped.meta.sourceFormat).toBe("frm");
        expect(reshaped.sequences).toHaveLength(6);
    });

    it("reshapes even an frm-tagged import (the re-tag defeats convertToFrm's no-op)", () => {
        const imported: Animation = { ...makeMiniBam(), meta: { sourceFormat: "frm" } };
        const reshaped = reshapeImportToFrm(imported);
        expect(reshaped.sequences).toHaveLength(6);
        expect(reshaped.palette).not.toBe(imported.palette); // converted, not aliased through the no-op
    });

    it("keeps a directional import's facings", () => {
        const bam8 = multiCycleBam(8);
        const reshaped = reshapeImportToFrm(bam8);
        expect(reshaped.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
    });
});
