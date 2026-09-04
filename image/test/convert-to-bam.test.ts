import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
    type IndexedAnimation,
    FRM_FACINGS,
    convertToBam,
    emptyPalette,
    parseFrm,
    parseBamV1,
    serializeBamV1,
} from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

// A 6-direction FRM whose every direction shares frame 0, with per-direction header offsets from the caller.
function frmSharingOneFrame(dirOffsetsX: number[]): IndexedAnimation {
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

describe("convertToBam anchor placement", () => {
    // Two same-sequence frames of differing heights, feet on one ground line (FRM convention).
    const twoHeights: IndexedAnimation = {
        palette: emptyPalette(),
        frames: [
            { width: 4, height: 10, pixels: new Uint8Array(40), offsetX: 0, offsetY: 0 },
            { width: 4, height: 6, pixels: new Uint8Array(24), offsetX: 0, offsetY: 0 },
        ],
        sequences: [{ frameRefs: [0, 1], facing: "NE" }],
        meta: { sourceFormat: "frm", directionLayout: "frm6" },
    };

    it("centres the anchors on the animation's union box instead of the FRM feet line", () => {
        const { animation } = convertToBam(twoHeights);
        // Union extent above the shared ground line is the tall frame's 10 rows; its centre sits
        // 4.5 rows above ground, so the tall frame's anchor lands mid-frame, not at its last row.
        expect(animation.frames[0]?.offsetY).toBe(5);
        expect(animation.frames[0]?.offsetX).toBe(2);
    });

    it("keeps differing-size frames registered: one shared translation, not per-frame centring", () => {
        const { animation } = convertToBam(twoHeights);
        const tall = animation.frames[0];
        const short = animation.frames[1];
        // Both anchors must still point at the same world point (the old ground line, shifted once):
        // their difference stays the feet-line difference. Per-frame centring (offsetY = h/2 each)
        // would break this and make a walk cycle bob.
        expect((tall?.offsetY ?? 0) - (short?.offsetY ?? 0)).toBe(10 - 6);
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
        // The rotations are re-laid onto IE's 8 direction slots, so the output is an ie8 cycle list -
        // see placeFrmRotations. Every source rotation survives; S and N are the slots FRM cannot fill.
        expect(animation.meta.directionLayout).toBe("ie8");
        expect(animation.sequences).toHaveLength(8);
        expect(animation.sequences.filter((s) => s.frameRefs.length === 0).map((s) => s.facing)).toEqual(["S", "N"]);
        expect(new Set(animation.sequences.map((s) => s.frameRefs.join(",")))).toEqual(
            new Set([...source.sequences.map((s) => s.frameRefs.join(",")), ""]),
        );
        expect(animation.frames.every((f) => f.rleEncoded === false)).toBe(true);
        expect(animation.frames.every((f) => f.rawEncoding === undefined)).toBe(true);

        expect(report.has("embedded-palette")).toBe(true);
        // The header fps/action frame have no BAM field; their drop is deliberately unreported.
        expect(report.lossless).toBe(true);
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

describe("convertToBam direction placement", () => {
    // BAM stores no facing tags - a cycle's direction IS its index - so a converted FRM keeps its
    // directions only if each one is written at the IE slot that means it. Tagging the sequences and
    // leaving them in FRM header order survives in memory and is lost the moment the file is written.
    it("writes each FRM rotation at the IE slot that means the same direction", () => {
        const frames = FRM_FACINGS.map((_, i) => ({
            width: 1,
            height: 1,
            pixels: new Uint8Array([i + 1]),
            offsetX: 0,
            offsetY: 0,
        }));
        const source: IndexedAnimation = {
            palette: emptyPalette(),
            frames,
            sequences: FRM_FACINGS.map((facing, i) => ({ frameRefs: [i], facing })),
            meta: { sourceFormat: "frm", directionLayout: "frm6" },
        };

        const reparsed = parseBamV1(serializeBamV1(convertToBam(source).animation));
        // Round-tripped through the container, each rotation must be findable at its own IE slot:
        // S(0) SW(1) W(2) NW(3) N(4) NE(5) E(6) SE(7).
        const pixelAt = (slot: number): number | undefined => {
            const ref = reparsed.sequences[slot]?.frameRefs[0];
            return ref === undefined ? undefined : reparsed.frames[ref]?.pixels[0];
        };
        const pixelFor: Map<string, number> = new Map(FRM_FACINGS.map((facing, i) => [facing, i + 1]));
        expect(pixelAt(1)).toBe(pixelFor.get("SW"));
        expect(pixelAt(2)).toBe(pixelFor.get("W"));
        expect(pixelAt(3)).toBe(pixelFor.get("NW"));
        expect(pixelAt(5)).toBe(pixelFor.get("NE"));
        expect(pixelAt(6)).toBe(pixelFor.get("E"));
        expect(pixelAt(7)).toBe(pixelFor.get("SE"));
    });

    // A single-orientation FRM says "show this everywhere" with six equal data offsets; spread over the
    // IE slots that has to stay everywhere, including the S and N a directional source cannot fill.
    it("fills every IE slot from a single-orientation source's one cycle", () => {
        const source = frmSharingOneFrame([0, 0, 0, 0, 0, 0]);
        const { animation } = convertToBam(source);
        expect(animation.sequences).toHaveLength(8);
        expect(animation.sequences.every((s) => s.frameRefs.length === 1)).toBe(true);
        expect(animation.sequences.map((s) => s.facing)).toEqual(["S", "SW", "W", "NW", "N", "NE", "E", "SE"]);
    });

    it("returns no cycles for a source that has none", () => {
        const source = frmSharingOneFrame([0, 0, 0, 0, 0, 0]);
        const { animation } = convertToBam({ ...source, sequences: [] });
        expect(animation.sequences).toEqual([]);
    });
});
