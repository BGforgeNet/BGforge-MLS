import path from "path";
import { describe, expect, it } from "vitest";
import { type Animation, LossReport } from "@bgforge/image";
import {
    ieGroupCount,
    needsCyclePick,
    reshapeImportToFrm,
    saveAsTargetPath,
    summarizeLoss,
} from "../../src/image-editor/save-as";
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

describe("ieGroupCount", () => {
    it("returns the 8-cycle block count for an ie8-resolved animation", () => {
        const base = multiCycleBam(16);
        const anim: Animation = { ...base, meta: { ...base.meta, directionLayout: "ie8" } };
        expect(ieGroupCount(anim)).toBe(2);
    });

    it("is undefined for non-ie8 layouts (needsCyclePick decides instead)", () => {
        expect(ieGroupCount(multiCycleBam(16))).toBeUndefined();
        expect(ieGroupCount(makeMiniFrm())).toBeUndefined();
    });
});

describe("summarizeLoss", () => {
    it("renders one bulleted detail line per loss", () => {
        const report = new LossReport();
        report.add("dropped-direction", "3 cycle(s) have no FRM slot: cycle 5 (facing N), cycle 6 (facing S), +1 more");
        report.add("dropped-action-frame", "source action frame 2 has no BAM equivalent");
        const { message, detail } = summarizeLoss(report);
        expect(message).toBe("Converting will lose data.");
        expect(detail.split("\n")).toEqual([
            "- 3 cycle(s) have no FRM slot: cycle 5 (facing N), cycle 6 (facing S), +1 more",
            "- source action frame 2 has no BAM equivalent",
        ]);
    });

    it("lists only real losses, not informational notes", () => {
        const report = new LossReport();
        report.add("embedded-palette", "palette embedded directly in the BAM output");
        report.add("dropped-action-frame", "source action frame 2 has no BAM equivalent");
        expect(summarizeLoss(report).detail).toBe("- source action frame 2 has no BAM equivalent");
    });
});

describe("reshapeImportToFrm", () => {
    it("builds a single-orientation FRM from the chosen cycle of a multi-cycle import", () => {
        const reshaped = reshapeImportToFrm(multiCycleBam(3), { singleCycle: 2 });
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

    it("converts one direction block of an IE base-file import (pick.ieGroup)", () => {
        const anim = multiCycleBam(8);
        // East slots (5-7) become shared-filler dummies - the IE base-file shape ieGroup extracts from.
        for (const i of [5, 6, 7]) anim.sequences[i] = { frameRefs: [0, 0], facing: "none" };
        const reshaped = reshapeImportToFrm(anim, { ieGroup: 0 });
        expect(reshaped.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
        // Directional, not single-orientation: the west-arc rotations carry distinct cycles.
        expect(new Set(reshaped.sequences.map((s) => s.frameRefs.join(","))).size).toBeGreaterThan(1);
    });
});
