import { describe, expect, test } from "vitest";
import { analyzeCycleGrid, ieGroupLabels } from "../../src/image-editor/webview/render/cycle-grouping";

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

// Detection itself (interpretIeDirections) is library code, tested in image/test/ie-direction.test.ts.

describe("ieGroupLabels", () => {
    test("names usar1ca's 8 blocks from the CA scheme, and the E-companion identically", () => {
        const labels = ieGroupLabels("usar1ca.bam", 8);
        // Engine playback order: loop first, release second per pair.
        expect(labels?.[0]).toBe("Conjure spell 1 (loop)");
        expect(labels?.[1]).toBe("Cast spell 1 (release)");
        expect(labels?.[7]).toBe("Cast spell 4 (release)");
        expect(ieGroupLabels("USAR1CAE.BAM", 8)).toEqual(labels);
    });

    test("disambiguates the shared G1 token by block count (character_old 9 vs monster_layered 6)", () => {
        expect(ieGroupLabels("chmb1g1.bam", 9)?.[8]).toBe("SL - sleep");
        expect(ieGroupLabels("mogrg1.bam", 6)?.[5]).toBe("TW - twitch");
    });

    test("returns undefined for an unknown token or a count no scheme matches", () => {
        expect(ieGroupLabels("harness-fixture-directional.bam", 2)).toBeUndefined();
        expect(ieGroupLabels("usar1ca.bam", 5)).toBeUndefined(); // CA scheme is 8 blocks, not 5
    });
});
