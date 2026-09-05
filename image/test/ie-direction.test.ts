import { describe, expect, test } from "vitest";
import type { Facing } from "../src/model/animation.ts";
import {
    directionLayoutOf,
    ieBlockSize,
    ieSchemeOf,
    ieBandsOfStride,
    ieFacingsForStride,
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

describe("ieBandsOfStride", () => {
    /** Five stances at sixteen facings each - the shape a quadrant monster's G2 file actually holds. */
    function bands16(stances: number): { sequences: SequenceShape[]; frameCount: number } {
        const sequences: SequenceShape[] = [];
        for (let band = 0; band < stances; band++) {
            for (let slot = 0; slot < 16; slot++) {
                const first = 1 + band * 40 + slot * 2;
                sequences.push(seq([first, first + 1]));
            }
        }
        return { sequences, frameCount: stances * 40 + 1 };
    }

    test("cuts the list at the stride the caller names, not the one inference would pick", () => {
        const { sequences, frameCount } = bands16(5);
        // Inference reads 80 cycles as ten 8-blocks, halving every stance.
        expect(interpretIeDirections(sequences, frameCount)?.groups).toHaveLength(10);
        const bands = ieBandsOfStride(sequences, frameCount, 16);
        expect(bands).toHaveLength(5);
        expect(bands?.[0]).toHaveLength(16);
    });

    test("names all sixteen points of the wheel, in stored-cycle order", () => {
        const { sequences, frameCount } = bands16(1);
        expect(ieBandsOfStride(sequences, frameCount, 16)?.[0]?.map((s) => s.facing)).toEqual([
            "S",
            "SSW",
            "SW",
            "WSW",
            "W",
            "WNW",
            "NW",
            "NNW",
            "N",
            "NNE",
            "NE",
            "ENE",
            "E",
            "ESE",
            "SE",
            "SSE",
        ]);
    });

    test("indexes back into the caller's own cycle list", () => {
        const { sequences, frameCount } = bands16(3);
        expect(ieBandsOfStride(sequences, frameCount, 16)?.[2]?.[0]?.seqIndex).toBe(32);
    });

    test("drops a cycle with no frames rather than drawing an empty facing", () => {
        const { sequences, frameCount } = bands16(1);
        sequences[3] = seq([]);
        const band = ieBandsOfStride(sequences, frameCount, 16)?.[0];
        expect(band).toHaveLength(15);
        expect(band?.map((s) => s.facing)).not.toContain("WSW");
    });

    test("still serves the strides inference already knows, so one partitioner covers both", () => {
        const { sequences, frameCount } = baseFileSequences(2);
        expect(ieBandsOfStride(sequences, frameCount, 8)).toHaveLength(2);
        expect(ieBandsOfStride(sequences, frameCount, 8)?.[0]?.[0]?.facing).toBe("S");
    });

    test("refuses a stride no IE scheme stores", () => {
        const { sequences, frameCount } = bands16(1);
        expect(ieBandsOfStride(sequences, frameCount, 7)).toBeUndefined();
    });
});

describe("ieBandsOfStride filler slots", () => {
    /** One band of `stride` cycles: `stored` real varied cycles, the rest one repeated filler frame. */
    function band(stride: number, stored: number, bands = 1): { sequences: SequenceShape[]; frameCount: number } {
        const sequences: SequenceShape[] = [];
        for (let b = 0; b < bands; b++) {
            for (let slot = 0; slot < stride; slot++) {
                const first = 1 + b * 100 + slot * 3;
                sequences.push(slot < stored ? seq([first, first + 1, first + 2]) : seq([0, 0, 0]));
            }
        }
        return { sequences, frameCount: bands * 100 + 1 };
    }

    test("drops the trailing slots every band fills with one repeated frame", () => {
        const { sequences, frameCount } = band(8, 5, 3);
        const bands = ieBandsOfStride(sequences, frameCount, 8);
        expect(bands?.map((b) => b.length)).toEqual([5, 5, 5]);
        expect(bands?.[0]?.map((s) => s.facing)).toEqual(["S", "SW", "W", "NW", "N"]);
    });

    test("keeps all sixteen when the file genuinely stores the eastern half", () => {
        const { sequences, frameCount } = band(16, 16);
        expect(ieBandsOfStride(sequences, frameCount, 16)?.[0]).toHaveLength(16);
    });

    test("drops the six the wheel leaves unstored when they are filler", () => {
        const { sequences, frameCount } = band(16, 10, 5);
        const bands = ieBandsOfStride(sequences, frameCount, 16);
        expect(bands?.map((b) => b.length)).toEqual([10, 10, 10, 10, 10]);
        expect(bands?.[0]?.at(-1)?.facing).toBe("NNE");
    });

    test("keeps a filler-looking slot that only ONE band leaves flat", () => {
        // A stance whose east really is one frame does not license dropping that facing everywhere.
        const { sequences, frameCount } = band(8, 8, 2);
        for (let slot = 5; slot < 8; slot++) sequences[slot] = seq([0, 0, 0]);
        expect(ieBandsOfStride(sequences, frameCount, 8)?.map((b) => b.length)).toEqual([8, 8]);
    });
});

describe("ieFacingsForStride", () => {
    test("names the eight-slot scheme's stored order, west arc first", () => {
        expect(ieFacingsForStride(8)).toEqual(["S", "SW", "W", "NW", "N", "NE", "E", "SE"]);
    });

    test("names the nine stored cycles of the finer scheme, due south round to due north", () => {
        expect(ieFacingsForStride(9)).toEqual(["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N"]);
    });

    test("continues the west arc's order back through the east for the whole wheel", () => {
        expect(ieFacingsForStride(16)).toEqual([
            "S",
            "SSW",
            "SW",
            "WSW",
            "W",
            "WNW",
            "NW",
            "NNW",
            "N",
            "NNE",
            "NE",
            "ENE",
            "E",
            "ESE",
            "SE",
            "SSE",
        ]);
    });

    // A caller asking about a stride no scheme stores gets nothing to iterate, rather than a wheel that
    // silently answers for a different resolution than the one it asked about.
    test("answers with no facings for a stride no IE scheme stores", () => {
        expect(ieFacingsForStride(6)).toEqual([]);
    });
});
