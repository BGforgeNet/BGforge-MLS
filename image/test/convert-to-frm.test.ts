import { describe, expect, it } from "vitest";
import {
    convertToFrm,
    serializeFrm,
    parseFrm,
    DEFAULT_FALLOUT_PALETTE,
    IE8_FACINGS,
    type Animation,
    type Facing,
    type Frame,
    type Sequence,
} from "@bgforge/image";

// Builds a BAM-shaped Animation with `seqLens.length` cycles, each holding `seqLens[i]` frames
// of distinct pixel content (so a specific frame can be traced through the conversion). Frames
// carry rawEncoding/rleEncoded like a real BAM parse, to exercise the FRM output's stripping.
function synthBam(seqLens: number[], facings?: Facing[]): Animation {
    const frames: Frame[] = [];
    const sequences: Sequence[] = seqLens.map((len, seqIdx) => {
        const frameRefs: number[] = [];
        for (let i = 0; i < len; i++) {
            const value = (seqIdx * 16 + i + 1) % 256;
            const pixels = new Uint8Array([value, value, value, value]);
            frames.push({
                width: 2,
                height: 2,
                pixels,
                offsetX: 0,
                offsetY: 0,
                rawEncoding: pixels,
                rleEncoded: false,
            });
            frameRefs.push(frames.length - 1);
        }
        const facing = facings?.[seqIdx] ?? "none";
        return { frameRefs, facing };
    });
    return {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        sequences,
        frames,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: facings ? "ie8" : "non-directional" },
    };
}

describe("convertToFrm", () => {
    it("uses an explicit 8-facing layout to select the 6 FRM directions and drop the rest", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2, 2, 2]);
        const { animation, report } = convertToFrm(source, { layout: [...IE8_FACINGS] });

        expect(animation.meta.sourceFormat).toBe("frm");
        expect(animation.meta.directionLayout).toBe("frm6");
        expect(animation.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);

        const droppedItems = report.items.filter((i) => i.kind === "dropped-direction");
        expect(droppedItems).toHaveLength(2);
    });

    it("pads unequal-length sequences to the max frame count and reports it", () => {
        const lens = [2, 3, 1, 4, 2, 3];
        const source = synthBam(lens);
        const { animation, report } = convertToFrm(source);

        const maxLen = Math.max(...lens);
        expect(animation.sequences.every((s) => s.frameRefs.length === maxLen)).toBe(true);

        const paddedItems = report.items.filter((i) => i.kind === "padded-sequence");
        expect(paddedItems).toHaveLength(lens.filter((n) => n !== maxLen).length);
    });

    it("duplicates a frame shared across directions and reports it", () => {
        // A 6-cycle source (positional -> FRM order) where two directions reference the same frame;
        // FRM cannot share a frame across directions, so it must be duplicated into two entries.
        const mk = (v: number): Frame => ({ width: 1, height: 1, pixels: new Uint8Array([v]), offsetX: 0, offsetY: 0 });
        const source: Animation = {
            palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
            sequences: [
                { frameRefs: [0], facing: "none" }, // NE
                { frameRefs: [0], facing: "none" }, // E - shares frame 0 with NE
                { frameRefs: [1], facing: "none" },
                { frameRefs: [2], facing: "none" },
                { frameRefs: [3], facing: "none" },
                { frameRefs: [4], facing: "none" },
            ],
            frames: [mk(1), mk(2), mk(3), mk(4), mk(5)],
            meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "non-directional" },
        };
        const { animation, report } = convertToFrm(source);
        expect(report.has("duplicated-shared-frames")).toBe(true);
        const neRef = animation.sequences[0]?.frameRefs[0];
        const eRef = animation.sequences[1]?.frameRefs[0];
        if (neRef === undefined || eRef === undefined) throw new Error("missing frame refs");
        expect(neRef).not.toBe(eRef); // two distinct pool entries, not one shared frame
        const neFrame = animation.frames[neRef];
        const eFrame = animation.frames[eRef];
        if (!neFrame || !eFrame) throw new Error("missing frames");
        expect([...neFrame.pixels]).toEqual([...eFrame.pixels]); // same pixel data, independent entries
    });

    it("throws for a non-standard cycle count with no layout and no real source facings", () => {
        const source = synthBam(Array.from({ length: 9 }, () => 1));
        expect(() => convertToFrm(source)).toThrow(
            /convertToFrm: 9-cycle BAM has no standard direction mapping; pass opts\.layout/,
        );
    });

    it("produces an FRM animation that serializes and reparses with pixels intact", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2, 2, 2]);
        const { animation } = convertToFrm(source, { layout: [...IE8_FACINGS] });

        const bytes = serializeFrm(animation);
        const reparsed = parseFrm(bytes);

        expect(reparsed.sequences).toHaveLength(6);
        for (let slot = 0; slot < 6; slot++) {
            const origSeq = animation.sequences[slot];
            const newSeq = reparsed.sequences[slot];
            if (!origSeq || !newSeq) throw new Error(`missing sequence at slot ${slot}`);
            expect(newSeq.frameRefs).toHaveLength(origSeq.frameRefs.length);
            for (let i = 0; i < origSeq.frameRefs.length; i++) {
                const origIdx = origSeq.frameRefs[i];
                const newIdx = newSeq.frameRefs[i];
                if (origIdx === undefined || newIdx === undefined) throw new Error("frame ref index out of range");
                const origFrame = animation.frames[origIdx];
                const newFrame = reparsed.frames[newIdx];
                if (!origFrame || !newFrame) throw new Error("frame out of range");
                expect(Buffer.from(newFrame.pixels).toString("hex")).toBe(
                    Buffer.from(origFrame.pixels).toString("hex"),
                );
            }
        }
    });

    it("keeps the source palette and strips rawEncoding when the palette cannot losslessly remap (sidecar path)", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2]);
        // Color absent from DEFAULT_FALLOUT_PALETTE (verified via a preceding grep of the file).
        const oddColor = { r: 1, g: 2, b: 3, a: 255 };
        const p1 = source.palette[1];
        if (!p1) throw new Error("expected palette index 1");
        source.palette[1] = oddColor; // index 1 is the pixel value of the first synthesized frame

        const { animation, report } = convertToFrm(source);

        expect(report.has("palette-sidecar-required")).toBe(true);
        expect(animation.palette).toEqual(source.palette);
        expect(animation.frames.length).toBeGreaterThan(0);
        expect(animation.frames.every((f) => f.rawEncoding === undefined)).toBe(true);
        expect(animation.frames.every((f) => f.rleEncoded === undefined)).toBe(true);
    });
});
