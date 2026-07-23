import { expect, test } from "vitest";
import { analyzeCycleGrid } from "../../src/image-editor/webview/render/cycle-grouping";

test("a single directional set (<=8 cycles) is not flagged as multi-sequence", () => {
    for (const n of [1, 4, 6, 8]) {
        expect(analyzeCycleGrid(n)).toEqual({ multiSequence: false, suggestedColumns: 0 });
    }
});

test("more than 8 cycles is flagged as multi-sequence with a suggested column count", () => {
    // usar1ca's 64 cycles (8 sequences x 8 directions) - the reported case: suggest 8 columns.
    expect(analyzeCycleGrid(64)).toEqual({ multiSequence: true, suggestedColumns: 8 });
    // 9 is >8 but not divisible by 8 or 6 - fall back to the IE-8 default (user overrides).
    expect(analyzeCycleGrid(9)).toEqual({ multiSequence: true, suggestedColumns: 8 });
});

test("a count divisible by 6 but not 8 suggests 6 columns", () => {
    expect(analyzeCycleGrid(18)).toEqual({ multiSequence: true, suggestedColumns: 6 });
});
