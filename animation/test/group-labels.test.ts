import { describe, expect, test } from "vitest";
import { ieGroupLabels } from "../src/group-labels";

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
