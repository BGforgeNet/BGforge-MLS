import { describe, expect, test } from "vitest";
import { analyzeCycleGrid, ieGroupOptionText } from "../../src/image-editor/webview/render/cycle-grouping";

test("a single directional set (<=8 cycles) is not flagged as multi-sequence", () => {
    for (const n of [1, 4, 6, 8]) {
        expect(analyzeCycleGrid(n)).toEqual({ multiSequence: false, suggestedColumns: 0 });
    }
});

test("more than 8 cycles is flagged as multi-sequence with a suggested column count", () => {
    // usar1ca's 64 cycles (8 sequences x 8 directions) - the reported case: suggest 8 columns.
    expect(analyzeCycleGrid(64)).toEqual({ multiSequence: true, suggestedColumns: 8 });
});

// The interpretation knows the block size; without it, 9 cycles reads as "more than one set" purely
// because 9 > 8, which is exactly wrong for the commonest creature file there is.
test("a known scheme sets the block size, so one block is never called multi-sequence", () => {
    expect(analyzeCycleGrid(9, "ie9")).toEqual({ multiSequence: false, suggestedColumns: 0 });
    expect(analyzeCycleGrid(8, "ie8")).toEqual({ multiSequence: false, suggestedColumns: 0 });
});

test("a known scheme suggests its own block size as the column count", () => {
    expect(analyzeCycleGrid(99, "ie9")).toEqual({ multiSequence: true, suggestedColumns: 9 });
    expect(analyzeCycleGrid(72, "ie9")).toEqual({ multiSequence: true, suggestedColumns: 9 });
    expect(analyzeCycleGrid(72, "ie8")).toEqual({ multiSequence: true, suggestedColumns: 8 });
});

test("a count divisible by 6 but not 8 suggests 6 columns", () => {
    expect(analyzeCycleGrid(18)).toEqual({ multiSequence: true, suggestedColumns: 6 });
});

// Detection itself (interpretIeDirections) is library code, tested in image/test/ie-direction.test.ts.

// The block NAMES moved to @bgforge/animation with the set browser that also needs them; they are
// covered by animation/test/group-labels.test.ts.

describe("ieGroupOptionText", () => {
    test("combines the scheme name with the group's cycle range", () => {
        expect(ieGroupOptionText(["WK - walk", "SC - combat stance"], 1)).toBe("SC - combat stance (cycles 8-15)");
    });

    test("falls back to a numbered group without labels", () => {
        expect(ieGroupOptionText(undefined, 0)).toBe("Group 1 (cycles 0-7)");
    });

    // The range is what the user picks a block by, so it has to count in the file's own block size.
    test("counts the range in the scheme's block size", () => {
        expect(ieGroupOptionText(undefined, 1, "ie9")).toBe("Group 2 (cycles 9-17)");
        expect(ieGroupOptionText(undefined, 1, "ie8")).toBe("Group 2 (cycles 8-15)");
    });
});
