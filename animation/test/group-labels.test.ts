import { describe, expect, test } from "vitest";
import { ieGroupLabels, ieGroups } from "../src/group-labels";

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

    // Three sections pack a different trio into a three-block eight-wide G2, so the structural key alone
    // hands two of them the third's names.
    test("lets the declared section override a colliding structural key", () => {
        expect(ieGroupLabels("makhg2.bam", 3, "ie8")?.[1]).toBe("A2/CA - attack or cast");
        expect(ieGroupLabels("makhg2.bam", 3, "ie8", "monster_ankheg")?.[1]).toBe("EMERGE - emerge");
        expect(ieGroupLabels("moghg2.bam", 3, "ie8", "monster_old")?.[2]).toBe("CA - cast");
    });

    test("keeps a section's names across the band width its mirror flag chooses", () => {
        expect(ieGroupLabels("makhg3.bam", 2, "ie8", "monster_ankheg")).toEqual(["A1 - attack", "CA - cast"]);
        expect(ieGroupLabels("makhg3.bam", 2, "ie9", "monster_ankheg")).toEqual(["A1 - attack", "CA - cast"]);
    });

    // The burrowing G1 opens on a block no sequence addresses, which is the one thing a numbered fallback
    // cannot say: the block is padding, not a stance whose name is unknown.
    test("marks the block the burrowing scheme addresses nothing to", () => {
        const groups = ieGroups("makhg1.bam", 4, "ie8", "monster_ankheg");
        expect(groups?.[0]?.unused).toBe(true);
        expect(groups?.slice(1).map((group) => group.label)).toEqual(["DE - die", "TW - twitch", "SD - stand"]);
        expect(groups?.some((group) => group.unused === true && group.id !== undefined)).toBe(false);
    });

    // A family that spreads its bands over several files numbers them from the packed name, and each of
    // those files still carries the family's whole skeleton.
    test("gives a split file its family's block names", () => {
        expect(ieGroupLabels("chmb1g15.bam", 11, "ie9")?.[5]).toBe("DE - die");
        expect(ieGroupLabels("meaeg21.bam", 7, "ie9")?.[1]).toBe("A2 - attack 2");
        expect(ieGroupLabels("meaeg11e.bam", 6, "ie9")?.[0]).toBe("WK - walk");
    });

    // A shorter file of the same family holds a PREFIX of its blocks: the layout addresses a stance by
    // position, so block 5 is the same stance whether the file stops there or carries three more.
    test("names the shorter files of the fine-scheme family", () => {
        expect(ieGroupLabels("msaig1.bam", 6, "ie9")?.[5]).toBe("TW - twitch");
        expect(ieGroupLabels("migog21.bam", 5, "ie9")?.[4]).toBe("A5 - attack 5");
    });
});
