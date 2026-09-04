import { describe, expect, test } from "vitest";
import type { Facing } from "../src/model/animation.ts";
import {
    directionLayoutOf,
    ieBlockSize,
    ieSchemeOf,
    interpretIeDirections,
    type SequenceShape,
} from "../src/model/ie-direction.ts";

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

/**
 * The character/monster shape: `blocks` of 9 cycles, every cycle in a block the same length (one action
 * at nine orientations), with distinct frames throughout. Nothing is stored for the east - the engine
 * mirrors it - so there are no dummy slots to find.
 */
function range(start: number, length: number): number[] {
    return Array.from({ length }, (_, k) => start + k);
}

function westArcSequences(blocks: number, perCycle = 2): { sequences: SequenceShape[]; frameCount: number } {
    const sequences: SequenceShape[] = [];
    let next = 0;
    for (let g = 0; g < blocks; g++) {
        for (let slot = 0; slot < 9; slot++) {
            sequences.push(seq(range(next, perCycle)));
            next += perCycle;
        }
    }
    return { sequences, frameCount: next };
}

const WEST_ARC_16 = ["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N"];

describe("scheme accessors", () => {
    test("ieBlockSize names the cycles per block of each creature layout, and nothing else", () => {
        expect(ieBlockSize("ie8")).toBe(8);
        expect(ieBlockSize("ie9")).toBe(9);
        expect(ieBlockSize("frm6")).toBeUndefined();
        expect(ieBlockSize("non-directional")).toBeUndefined();
        expect(ieBlockSize(undefined)).toBeUndefined();
    });

    test("ieSchemeOf narrows a stamped layout to a scheme", () => {
        expect(ieSchemeOf("ie8")).toBe("ie8");
        expect(ieSchemeOf("ie9")).toBe("ie9");
        expect(ieSchemeOf("frm6")).toBeUndefined();
        expect(ieSchemeOf(undefined)).toBeUndefined();
    });

    test("directionLayoutOf stamps only a detected shape", () => {
        const { sequences, frameCount } = westArcSequences(1);
        expect(directionLayoutOf(interpretIeDirections(sequences, frameCount))).toBe("ie9");
        // Interpretable but undetected - a lone short set - is not what the file is declared to be.
        expect(directionLayoutOf(interpretIeDirections([seq([0]), seq([1])], 2))).toBe("non-directional");
        expect(directionLayoutOf(undefined)).toBe("non-directional");
    });
});

describe("interpretIeDirections", () => {
    test("reads a 9-cycle file as one western arc of the 16-point wheel", () => {
        const { sequences, frameCount } = westArcSequences(1);
        const result = interpretIeDirections(sequences, frameCount);
        expect(result?.scheme).toBe("ie9");
        expect(result?.detected).toBe(true);
        expect(result?.groups).toHaveLength(1);
        expect(result?.groups[0]?.map((s) => s.facing)).toEqual(WEST_ARC_16);
    });

    // 72 cycles is nine 8-blocks or eight 9-blocks. Reading one as the other keeps every cycle and
    // silently relabels its direction, so the block shape - not the count - has to decide.
    test("reads a 72-cycle file of uniform 9-blocks as the fine scheme", () => {
        // Each block is one action, so its nine cycles share a frame count while the blocks differ -
        // which cuts cleanly at 9 and raggedly at 8.
        const sequences: SequenceShape[] = [];
        let next = 0;
        for (let block = 0; block < 8; block++) {
            for (let slot = 0; slot < 9; slot++) {
                sequences.push(seq(range(next, block + 1)));
                next += block + 1;
            }
        }
        const result = interpretIeDirections(sequences, next);
        expect(result?.scheme).toBe("ie9");
        expect(result?.groups).toHaveLength(8);
        expect(result?.groups[7]?.map((s) => s.facing)).toEqual(WEST_ARC_16);
    });

    test("reads a 72-cycle base file of 8-blocks as the coarse scheme", () => {
        const { sequences, frameCount } = baseFileSequences(9);
        const result = interpretIeDirections(sequences, frameCount);
        expect(result?.scheme).toBe("ie8");
        expect(result?.detected).toBe(true);
        expect(result?.groups).toHaveLength(9);
        expect(result?.groups[0]?.map((s) => s.facing)).toEqual(["S", "SW", "W", "NW", "N"]);
    });

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

    // A multi-block E-file has empty west slots, so NEITHER stride finds uniform arcs and the scores tie
    // at zero. With no structural evidence either way the coarse reading has to win: it is the only one
    // an east companion can be, and its cycle count is a multiple of both strides.
    test("a multi-block E-file stays coarse when neither stride finds block structure", () => {
        const sequences: SequenceShape[] = [];
        let next = 1;
        for (let block = 0; block < 9; block++) {
            for (let slot = 0; slot < 8; slot++) {
                sequences.push(slot < 5 ? seq([]) : seq([next++, next++]));
            }
        }
        const result = interpretIeDirections(sequences, next);
        expect(result?.scheme).toBe("ie8");
        expect(result?.groups[0]?.map((s) => s.facing)).toEqual(["NE", "E", "SE"]);
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
