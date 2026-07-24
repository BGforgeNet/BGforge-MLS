import { describe, expect, test } from "vitest";
import type { Facing } from "../src/model/animation.ts";
import { interpretIeDirections, type SequenceShape } from "../src/model/ie-direction.ts";

function seq(frameRefs: number[], facing: Facing = "none"): SequenceShape {
    return { frameRefs, facing };
}

/**
 * The usar1ca shape scaled down: `blocks` 8-slot direction blocks, slots 0-4 real varied cycles,
 * slots 5-7 stuffed with one shared filler frame (the base-file convention for the unstored east).
 * Frame indices stay in range for a frame table of `blocks * 10 + 1` entries; the filler is frame 0.
 */
function baseFileSequences(blocks: number): { sequences: SequenceShape[]; frameCount: number } {
    const sequences: SequenceShape[] = [];
    for (let g = 0; g < blocks; g++) {
        for (let slot = 0; slot < 5; slot++) {
            const first = 1 + g * 10 + slot * 2;
            sequences.push(seq([first, first + 1]));
        }
        for (let slot = 5; slot < 8; slot++) sequences.push(seq([0, 0, 0]));
    }
    return { sequences, frameCount: blocks * 10 + 1 };
}

describe("interpretIeDirections", () => {
    test("detects the base-file fingerprint: stride-8 blocks, real west slots, shared-filler east slots", () => {
        const { sequences, frameCount } = baseFileSequences(2);
        const result = interpretIeDirections(sequences, frameCount);
        expect(result?.detected).toBe(true);
        expect(result?.groups).toHaveLength(2);
        // Each block keeps only its 5 stored west-arc slots, in IE order S, SW, W, NW, N.
        expect(result?.groups[0]?.map((s) => s.facing)).toEqual(["S", "SW", "W", "NW", "N"]);
        expect(result?.groups[1]?.map((s) => s.seqIndex)).toEqual([8, 9, 10, 11, 12]);
    });

    test("empty east slots (or 0xFFFF sentinel refs) also count as dummies", () => {
        const { sequences, frameCount } = baseFileSequences(2);
        // Mix the two real-world dummy styles: a zero-frame cycle and a cycle of out-of-range sentinels.
        sequences[5] = seq([]);
        sequences[14] = seq([65535, 65535]);
        const result = interpretIeDirections(sequences, frameCount);
        expect(result?.detected).toBe(true);
        expect(result?.groups.every((g) => g.length === 5)).toBe(true);
    });

    test("east slots with real varied animation are kept, and defeat the base-file fingerprint", () => {
        const { sequences, frameCount } = baseFileSequences(1);
        // Slot 5 becomes a genuine cycle (varied refs) - a full-8-direction file, not a base file.
        sequences[5] = seq([1, 2, 3]);
        const result = interpretIeDirections(sequences, frameCount);
        expect(result?.detected).toBe(false);
        expect(result?.groups[0]?.map((s) => s.facing)).toContain("NE");
    });

    test("east slots stuffed with DIFFERENT constant frames are not one shared filler", () => {
        const { sequences, frameCount } = baseFileSequences(1);
        sequences[6] = seq([2, 2]); // filler frame differs from the others' frame 0
        expect(interpretIeDirections(sequences, frameCount)?.detected).toBe(false);
    });

    test("an E-file shape (west slots empty, east slots real) is interpretable but not detected", () => {
        const sequences = [...Array.from({ length: 5 }, () => seq([65535])), seq([1, 2]), seq([3, 4]), seq([5, 6])];
        const result = interpretIeDirections(sequences, 7);
        expect(result?.detected).toBe(false);
        expect(result?.groups[0]?.map((s) => s.facing)).toEqual(["NE", "E", "SE"]);
    });

    test("a lone <=8-cycle set maps slots to the IE order without claiming detection", () => {
        const sequences = Array.from({ length: 5 }, (_, i) => seq([i]));
        const result = interpretIeDirections(sequences, 5);
        expect(result?.detected).toBe(false);
        expect(result?.groups).toHaveLength(1);
        expect(result?.groups[0]?.map((s) => s.facing)).toEqual(["S", "SW", "W", "NW", "N"]);
    });

    test("returns undefined for shapes that cannot map onto 8-slot blocks", () => {
        // >8 cycles but not a multiple of 8: no block structure to interpret.
        expect(
            interpretIeDirections(
                Array.from({ length: 12 }, (_, i) => seq([i])),
                12,
            ),
        ).toBeUndefined();
        // Tagged facings use their own compass layout, never the IE slot mapping.
        expect(interpretIeDirections([seq([0], "NE")], 1)).toBeUndefined();
        expect(interpretIeDirections([], 0)).toBeUndefined();
    });

    test("a block with no real west cycle defeats detection (nothing directional to show)", () => {
        const { sequences, frameCount } = baseFileSequences(2);
        for (let slot = 0; slot < 5; slot++) sequences[8 + slot] = seq([]);
        const result = interpretIeDirections(sequences, frameCount);
        expect(result?.detected).toBe(false);
    });
});
