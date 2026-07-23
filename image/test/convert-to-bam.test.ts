import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
    type Animation,
    FRM_FACINGS,
    convertToBam,
    emptyPalette,
    parseFrm,
    parseBamV1,
    serializeBamV1,
} from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

// A 6-direction FRM whose every direction shares frame 0, with per-direction header offsets from the caller.
function frmSharingOneFrame(dirOffsetsX: number[]): Animation {
    return {
        palette: emptyPalette(),
        frames: [{ width: 1, height: 1, pixels: new Uint8Array([0]), offsetX: 0, offsetY: 0 }],
        sequences: FRM_FACINGS.map((facing) => ({ frameRefs: [0], facing })),
        meta: { sourceFormat: "frm", directionLayout: "frm6", dirOffsetsX, dirOffsetsY: [0, 0, 0, 0, 0, 0] },
    };
}

describe("convertToBam shared-frame offsets", () => {
    it("reports when directions sharing a frame carry differing per-direction offsets", () => {
        const { report } = convertToBam(frmSharingOneFrame([0, 5, 0, 0, 0, 0]));
        expect(report.has("shared-frame-direction-offset")).toBe(true);
        expect(report.lossless).toBe(false); // a real precision loss, not an informational note
    });

    it("stays silent when the shared directions' offsets match", () => {
        const { report } = convertToBam(frmSharingOneFrame([0, 0, 0, 0, 0, 0]));
        expect(report.has("shared-frame-direction-offset")).toBe(false);
    });
});

// hanpwroe.frm carries a non-zero fps (10) and action frame (2) in its header, so both
// dropped-* loss items are exercised alongside the always-present embedded-palette one.
const frms = corpusFiles(FALLOUT_ART, ".frm");
const frmWithFpsAndAction = frms.find((f) => path.basename(f) === "hanpwroe.frm");

describe.skipIf(frms.length === 0)("convertToBam", () => {
    it("converts an FRM to a BAM-shaped animation with a loss report", () => {
        const file = frmWithFpsAndAction;
        if (!file) throw new Error("expected hanpwroe.frm in the FRM corpus");
        const source = parseFrm(new Uint8Array(fs.readFileSync(file)));
        const { animation, report } = convertToBam(source);

        expect(animation.meta.sourceFormat).toBe("bam");
        expect(animation.meta.transparentIndex).toBe(0);
        expect(animation.meta.directionLayout).toBe("frm6");
        expect(animation.sequences).toHaveLength(6);
        expect(animation.sequences.map((s) => s.frameRefs)).toEqual(source.sequences.map((s) => s.frameRefs));
        expect(animation.frames.every((f) => f.rleEncoded === false)).toBe(true);
        expect(animation.frames.every((f) => f.rawEncoding === undefined)).toBe(true);

        expect(report.has("embedded-palette")).toBe(true);
        expect(report.has("dropped-fps")).toBe(true);
        expect(report.has("dropped-action-frame")).toBe(true);
    });

    it("omits dropped-fps/dropped-action-frame when the source FRM has neither set", () => {
        const file = frms[0];
        if (!file) throw new Error("expected at least one FRM in the corpus");
        const source = parseFrm(new Uint8Array(fs.readFileSync(file)));
        source.meta.fps = 0;
        source.meta.actionFrame = 0;
        const { report } = convertToBam(source);

        expect(report.has("embedded-palette")).toBe(true);
        expect(report.has("dropped-fps")).toBe(false);
        expect(report.has("dropped-action-frame")).toBe(false);
    });

    it("round-trips frame pixels losslessly through serialize -> parse", () => {
        const file = frms[0];
        if (!file) throw new Error("expected at least one FRM in the corpus");
        const source = parseFrm(new Uint8Array(fs.readFileSync(file)));
        const { animation } = convertToBam(source);

        const reparsed = parseBamV1(serializeBamV1(animation));
        expect(reparsed.frames).toHaveLength(source.frames.length);
        for (let i = 0; i < source.frames.length; i++) {
            const sf = source.frames[i];
            const rf = reparsed.frames[i];
            if (!sf || !rf) throw new Error("index out of range against source.frames.length");
            expect(Buffer.from(rf.pixels).toString("hex")).toBe(Buffer.from(sf.pixels).toString("hex"));
        }
    });

    it("is a no-op for an already-BAM animation, returning a new object with an empty report", () => {
        const bamSource = parseBamV1(
            serializeBamV1({
                palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 })),
                sequences: [{ frameRefs: [0], facing: "none" }],
                frames: [{ width: 1, height: 1, pixels: new Uint8Array([0]), offsetX: 0, offsetY: 0 }],
                meta: { sourceFormat: "bam", transparentIndex: 0 },
            }),
        );
        const { animation, report } = convertToBam(bamSource);

        expect(animation).not.toBe(bamSource);
        expect(animation.meta).not.toBe(bamSource.meta);
        expect(animation).toEqual(bamSource);
        expect(report.items).toEqual([]);
    });
});
