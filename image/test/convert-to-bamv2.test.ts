import { describe, expect, it } from "vitest";
import { type IndexedAnimation, type RgbaAnimation, emptyPalette } from "../src/model/animation.ts";
import { convertToBamV2, needsFreshPages } from "../src/convert/to-bamv2.ts";
import { readBamV2Structure } from "../src/bam/v2-structure.ts";
import { serializeBamV2 } from "../src/bam/v2-serialize.ts";

/** An indexed animation whose two cycles share a frame, so their references cannot both be a range. */
function sharedFrameAnimation(): IndexedAnimation {
    const palette = emptyPalette();
    palette[1] = { r: 10, g: 20, b: 30, a: 255 };
    palette[2] = { r: 40, g: 50, b: 60, a: 255 };
    const frame = (
        value: number,
    ): { width: number; height: number; pixels: Uint8Array; offsetX: number; offsetY: number } => ({
        width: 1,
        height: 1,
        pixels: Uint8Array.from([value]),
        offsetX: 0,
        offsetY: 0,
    });
    return {
        palette,
        frames: [frame(1), frame(2)],
        sequences: [
            { frameRefs: [0, 1], facing: "NE" },
            { frameRefs: [1, 0], facing: "E" },
        ],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}

describe("convertToBamV2", () => {
    it("resolves an indexed animation's palette into true-colour pixels", () => {
        const { animation } = convertToBamV2(sharedFrameAnimation());

        expect(animation.colorModel).toBe("rgba");
        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected frames");
        expect([...frame.pixels]).toEqual([10, 20, 30, 255]);
    });

    it("lays every cycle out as a contiguous run, which is the only shape v2 can express", () => {
        // A v2 cycle is a start index plus a count. The source's second cycle runs backwards over
        // shared frames, so the frames have to be duplicated - and the serializer is the proof.
        const { animation } = convertToBamV2(sharedFrameAnimation());

        const saved = serializeBamV2(animation, { basePage: 5000 });

        const structure = readBamV2Structure(saved.bam);
        expect(structure.cycles.map((c) => c.frameCount)).toEqual([2, 2]);
        expect(structure.cycles.map((c) => c.frameStart)).toEqual([0, 2]);
    });

    it("keeps what each cycle shows, in order, after the duplication", () => {
        const { animation } = convertToBamV2(sharedFrameAnimation());

        const colourOf = (ref: number): number[] => [...(animation.frames[ref]?.pixels.subarray(0, 3) ?? [])];
        const shown = animation.sequences.map((s) => s.frameRefs.map((r) => colourOf(r)));
        expect(shown).toEqual([
            [
                [10, 20, 30],
                [40, 50, 60],
            ],
            [
                [40, 50, 60],
                [10, 20, 30],
            ],
        ]);
    });

    it("records the duplication without calling it a loss, because nothing was lost", () => {
        // Duplicated frames cost file size, not fidelity - a "Converting will lose data" modal here
        // would be false, and false warnings are how real ones get ignored.
        const { report } = convertToBamV2(sharedFrameAnimation());

        expect(report.has("duplicated-shared-frames")).toBe(true);
        expect(report.lossless).toBe(true);
    });

    it("duplicates nothing when the cycles are already contiguous runs", () => {
        const anim = sharedFrameAnimation();
        anim.sequences = [{ frameRefs: [0, 1], facing: "NE" }];

        const { animation, report } = convertToBamV2(anim);

        expect(animation.frames).toHaveLength(2);
        expect(report.has("duplicated-shared-frames")).toBe(false);
    });

    it("keeps a frame no cycle references rather than dropping it on the floor", () => {
        const anim = sharedFrameAnimation();
        anim.sequences = [{ frameRefs: [0], facing: "NE" }];

        const { animation } = convertToBamV2(anim);

        expect(animation.frames).toHaveLength(2);
    });

    it("refuses a cycle pointing past the end of the frame table", () => {
        // A malformed animation must not be laid out into a file that looks valid: the bad
        // reference has to surface here, where the index is still traceable to its cycle.
        const anim = sharedFrameAnimation();
        anim.sequences = [{ frameRefs: [0, 9], facing: "NE" }];

        expect(() => convertToBamV2(anim)).toThrow(/out-of-range frame index 9/);
    });

    it("passes a true-colour animation through with its page provenance intact", () => {
        // A v2 saved as a v2 must still be able to re-emit its own pages; a conversion that rebuilt
        // the frames would strip that and force a lossy re-encode of pixels nothing had touched.
        const pixels = new Uint8Array(4);
        pixels.set([1, 2, 3, 255]);
        const anim: RgbaAnimation = {
            colorModel: "rgba",
            frames: [{ width: 1, height: 1, pixels, offsetX: 0, offsetY: 0, sourceBlocks: [] }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bamv2" },
            sourcePages: new Map([[7, Uint8Array.from([9])]]),
        };

        const { animation, report } = convertToBamV2(anim);

        expect(animation.sourcePages).toBe(anim.sourcePages);
        expect(animation.frames[0]?.sourceBlocks).toBeDefined();
        expect(report.lossless).toBe(true);
    });
});

describe("needsFreshPages", () => {
    it("is true for an animation converted up from an indexed one", () => {
        // Nothing in a PVRZ page describes these pixels, so a save has to write new pages - which is
        // what makes a page number the caller's decision rather than a detail.
        expect(needsFreshPages(convertToBamV2(sharedFrameAnimation()).animation)).toBe(true);
    });

    it("is false while every frame still carries the blocks it was read from", () => {
        const pixels = new Uint8Array(4);
        const anim: RgbaAnimation = {
            colorModel: "rgba",
            frames: [{ width: 1, height: 1, pixels, offsetX: 0, offsetY: 0, sourceBlocks: [] }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bamv2" },
            sourcePages: new Map(),
        };

        expect(needsFreshPages(anim)).toBe(false);
    });
});
