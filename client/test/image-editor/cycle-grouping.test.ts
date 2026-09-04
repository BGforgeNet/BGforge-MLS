import { describe, expect, test } from "vitest";
import {
    analyzeCycleGrid,
    ieGroupLabels,
    ieGroupOptionText,
} from "../../src/image-editor/webview/render/cycle-grouping";

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

describe("ieGroupLabels", () => {
    test("names usar1ca's 8 blocks from the CA scheme, and the E-companion identically", () => {
        const labels = ieGroupLabels("usar1ca.bam", 8, "ie8");
        // Engine playback order: loop first, release second per pair.
        expect(labels?.[0]).toBe("Conjure spell 1 (loop)");
        expect(labels?.[1]).toBe("Cast spell 1 (release)");
        expect(labels?.[7]).toBe("Cast spell 4 (release)");
        expect(ieGroupLabels("USAR1CAE.BAM", 8, "ie8")).toEqual(labels);
    });

    test("disambiguates the shared G1 token by block count (character_old 9 vs monster_layered 6)", () => {
        expect(ieGroupLabels("chmb1g1.bam", 9, "ie8")?.[8]).toBe("SL - sleep");
        expect(ieGroupLabels("mogrg1.bam", 6, "ie8")?.[5]).toBe("TW - twitch");
    });

    // The same token and block count mean different things under the two schemes, so the scheme is part
    // of the key: nine blocks of eight is the coarse character set, nine blocks of nine is not it.
    test("names the fine-scheme block sets", () => {
        expect(ieGroupLabels("mtrog2.bam", 7, "ie9")?.[0]).toBe("A1 - attack 1");
        expect(ieGroupLabels("mtrog2.bam", 7, "ie9")?.[6]).toBe("CA - cast (release)");
        expect(ieGroupLabels("wqlh4g1.bam", 11, "ie9")?.[0]).toBe("WK - walk");
        expect(ieGroupLabels("wqnh5ca.bam", 8, "ie9")?.[1]).toBe("Cast spell 1 (release)");
    });

    test("does not lend one scheme's block names to the other", () => {
        expect(ieGroupLabels("chmb1g1.bam", 9, "ie9")).toBeUndefined();
        expect(ieGroupLabels("mtrog2.bam", 7, "ie8")).toBeUndefined();
    });

    test("returns undefined for an unknown token or a count no scheme matches", () => {
        expect(ieGroupLabels("harness-fixture-directional.bam", 2)).toBeUndefined();
        expect(ieGroupLabels("usar1ca.bam", 5)).toBeUndefined(); // CA scheme is 8 blocks, not 5
    });
});

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
