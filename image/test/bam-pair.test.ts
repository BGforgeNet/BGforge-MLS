import { describe, expect, it } from "vitest";
import {
    combineIeBamPair,
    parseBamV1,
    serializeBamV1,
    splitIeBamPair,
    DEFAULT_FALLOUT_PALETTE,
    type IndexedAnimation,
    type Frame,
    type Sequence,
} from "@bgforge/image";

function px(v: number): Frame {
    return { width: 1, height: 1, pixels: new Uint8Array([v]), offsetX: 0, offsetY: 0 };
}

function bam(sequences: Sequence[], frames: Frame[]): IndexedAnimation {
    return {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        frames,
        sequences,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "ie8", fps: 15 },
    };
}

// The base file: per block, slots 0-4 hold one traceable frame (1 + block*16 + slot), slots 5-7 the
// shared filler frame 0 (pixel 255) - the detected base-file fingerprint.
function makeBase(blocks: number): IndexedAnimation {
    const frames: Frame[] = [px(255)];
    const sequences: Sequence[] = [];
    for (let g = 0; g < blocks; g++) {
        for (let slot = 0; slot < 5; slot++) {
            frames.push(px(1 + g * 16 + slot));
            sequences.push({ frameRefs: [frames.length - 1], facing: "none" });
        }
        for (let slot = 5; slot < 8; slot++) sequences.push({ frameRefs: [0, 0], facing: "none" });
    }
    return bam(sequences, frames);
}

// The *E companion: same block layout, west slots dummied with 0xFFFF sentinels, east slots real
// (traceable as 100 + block*16 + slot).
function makeEast(blocks: number): IndexedAnimation {
    const frames: Frame[] = [];
    const sequences: Sequence[] = [];
    for (let g = 0; g < blocks; g++) {
        for (let slot = 0; slot < 5; slot++) sequences.push({ frameRefs: [65535], facing: "none" });
        for (let slot = 5; slot < 8; slot++) {
            frames.push(px(100 + g * 16 + slot));
            sequences.push({ frameRefs: [frames.length - 1], facing: "none" });
        }
    }
    return bam(sequences, frames);
}

function cyclePixel(anim: IndexedAnimation, cycle: number): number | undefined {
    const ref = anim.sequences[cycle]?.frameRefs[0];
    const frame = ref === undefined ? undefined : anim.frames[ref];
    return frame?.pixels[0];
}

describe("combineIeBamPair", () => {
    it("fills each block's east slots from the companion, west slots from the base", () => {
        const combined = combineIeBamPair(makeBase(2), makeEast(2));
        expect(combined).toBeDefined();
        if (!combined) throw new Error("expected a combined animation");
        expect(combined.sequences).toHaveLength(16);
        expect(combined.meta.directionLayout).toBe("ie8");
        expect(cyclePixel(combined, 0)).toBe(1); // block 0 S from the base
        expect(cyclePixel(combined, 5)).toBe(105); // block 0 NE from the companion
        expect(cyclePixel(combined, 8 + 7)).toBe(100 + 16 + 7); // block 1 SE from the companion
        // The companion's sentinel west dummies contribute nothing.
        expect(combined.sequences.every((s) => s.frameRefs.every((r) => r >= 0 && r < combined.frames.length))).toBe(
            true,
        );
    });

    it("rejects mismatched pairs", () => {
        // Cycle-count mismatch.
        expect(combineIeBamPair(makeBase(2), makeEast(1))).toBeUndefined();
        // Base without the detected fingerprint (an east-shaped file is not a base).
        expect(combineIeBamPair(makeEast(1), makeEast(1))).toBeUndefined();
        // Companion with no east cycles (a second base is not a companion).
        expect(combineIeBamPair(makeBase(1), makeBase(1))).toBeUndefined();
        // Palette mismatch.
        const otherPalette = makeEast(1);
        const c1 = otherPalette.palette[1];
        if (!c1) throw new Error("expected palette entry");
        otherPalette.palette[1] = { ...c1, r: (c1.r + 1) % 256 };
        expect(combineIeBamPair(makeBase(1), otherPalette)).toBeUndefined();
        // Transparent-index mismatch (the merged pool shares one index space).
        const otherTransparent = makeEast(1);
        otherTransparent.meta.transparentIndex = 5;
        expect(combineIeBamPair(makeBase(1), otherTransparent)).toBeUndefined();
    });
});

describe("splitIeBamPair", () => {
    it("round-trips through the real serializer: split, serialize, parse, recombine", () => {
        const combined = combineIeBamPair(makeBase(2), makeEast(2));
        if (!combined) throw new Error("expected a combined animation");
        const split = splitIeBamPair(combined);
        expect(split).toBeDefined();
        if (!split) throw new Error("expected a split pair");

        // Each side carries only its own frames (compacted pools, no cross-side leakage).
        expect(split.base.frames).toHaveLength(10); // 2 blocks x 5 west cycles
        expect(split.east.frames).toHaveLength(6); // 2 blocks x 3 east cycles

        const parsedBase = parseBamV1(serializeBamV1(split.base));
        const parsedEast = parseBamV1(serializeBamV1(split.east));
        expect(parsedBase.meta.directionLayout).toBe("ie8"); // empty east dummies still fingerprint
        const recombined = combineIeBamPair(parsedBase, parsedEast);
        expect(recombined).toBeDefined();
        if (!recombined) throw new Error("expected a recombined animation");
        for (let cycle = 0; cycle < combined.sequences.length; cycle++) {
            expect(cyclePixel(recombined, cycle)).toBe(cyclePixel(combined, cycle));
        }
    });

    it("returns undefined when the animation no longer fits the 8-slot blocks", () => {
        const combined = combineIeBamPair(makeBase(1), makeEast(1));
        if (!combined) throw new Error("expected a combined animation");
        // An appended 9th cycle breaks the stride.
        combined.sequences.push({ frameRefs: [0], facing: "none" });
        expect(splitIeBamPair(combined)).toBeUndefined();
        // Tagged facings use their own layout, never the IE slots.
        const tagged = makeBase(1);
        const first = tagged.sequences[0];
        if (!first) throw new Error("expected a sequence");
        tagged.sequences[0] = { ...first, facing: "S" };
        expect(splitIeBamPair(tagged)).toBeUndefined();
    });
});
