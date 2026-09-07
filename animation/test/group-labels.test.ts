import { describe, expect, test } from "vitest";
import { type IeScheme } from "@bgforge/image/ie-direction";
import { ieGroups } from "../src/group-labels";

/** Just the block names, which is what most of these assert on. */
function labelsOf(basename: string, count: number, scheme?: IeScheme, section?: string): string[] | undefined {
    return ieGroups(basename, count, scheme, section)?.map((group) => group.label);
}

describe("ieGroups", () => {
    test("names usar1ca's 8 blocks from the CA scheme, and the E-companion identically", () => {
        const labels = labelsOf("usar1ca.bam", 8, "ie8");
        // Engine playback order: loop first, release second per pair.
        expect(labels?.[0]).toBe("Conjure spell 1 (loop)");
        expect(labels?.[1]).toBe("Cast spell 1 (release)");
        expect(labels?.[7]).toBe("Cast spell 4 (release)");
        expect(labelsOf("USAR1CAE.BAM", 8, "ie8")).toEqual(labels);
    });

    test("disambiguates the shared G1 token by block count (character_old 9 vs monster_layered 6)", () => {
        expect(ieGroups("chmb1g1.bam", 9, "ie8")?.[8]?.label).toBe("SL - sleep");
        expect(ieGroups("mogrg1.bam", 6, "ie8")?.[5]?.label).toBe("TW - twitch");
    });

    // The same token and block count mean different things under the two schemes, so the scheme is part
    // of the key: nine blocks of eight is the coarse character set, nine blocks of nine is not it.
    test("names the fine-scheme block sets", () => {
        expect(ieGroups("mtrog2.bam", 7, "ie9")?.[0]?.label).toBe("A1 - attack 1");
        expect(ieGroups("mtrog2.bam", 7, "ie9")?.[6]?.label).toBe("CA - cast (release)");
        expect(ieGroups("wqlh4g1.bam", 11, "ie9")?.[0]?.label).toBe("WK - walk");
        expect(ieGroups("wqnh5ca.bam", 8, "ie9")?.[1]?.label).toBe("Cast spell 1 (release)");
    });

    test("does not lend one scheme's block names to the other", () => {
        expect(ieGroups("chmb1g1.bam", 9, "ie9")).toBeUndefined();
        expect(ieGroups("mtrog2.bam", 7, "ie8")).toBeUndefined();
    });

    test("returns undefined for an unknown token or a count no scheme matches", () => {
        expect(ieGroups("harness-fixture-directional.bam", 2)).toBeUndefined();
        expect(ieGroups("usar1ca.bam", 5)).toBeUndefined(); // CA scheme is 8 blocks, not 5
    });

    // Three sections pack a different trio into a three-block eight-wide G2, so the structural key alone
    // hands two of them the third's names.
    test("lets the declared section override a colliding structural key", () => {
        expect(ieGroups("makhg2.bam", 3, "ie8")?.[1]?.label).toBe("A2/CA - attack or cast");
        expect(ieGroups("makhg2.bam", 3, "ie8", "monster_ankheg")?.[1]?.label).toBe("EMERGE - emerge");
        expect(ieGroups("moghg2.bam", 3, "ie8", "monster_old")?.[2]?.label).toBe("CA - cast");
    });

    test("keeps a section's names across the band width its mirror flag chooses", () => {
        expect(labelsOf("makhg3.bam", 2, "ie8", "monster_ankheg")).toEqual(["A1 - attack", "CA - cast"]);
        expect(labelsOf("makhg3.bam", 2, "ie9", "monster_ankheg")).toEqual(["A1 - attack", "CA - cast"]);
    });

    // The burrowing G1 opens on a block no sequence addresses, which is the one thing a numbered fallback
    // cannot say: the block is padding, not a stance whose name is unknown.
    test("marks the block the burrowing scheme addresses nothing to", () => {
        const groups = ieGroups("makhg1.bam", 4, "ie8", "monster_ankheg");
        expect(groups?.[0]?.unused).toBe(true);
        expect(groups?.slice(1).map((group) => group.label)).toEqual([
            "DE - die",
            "TW - twitch",
            "SD - stand (emerged)",
        ]);
        expect(groups?.some((group) => group.unused === true && group.id !== undefined)).toBe(false);
    });

    /**
     * The burrowing scheme stands twice - once above ground and once under it - and only the emerged one is
     * the stance every other family calls `stand`. Both reference implementations name the underground block
     * a stand of its own; calling it a combat stance named a third thing neither of them does.
     */
    test("names the burrowing scheme's two standing blocks apart", () => {
        const hidden = ieGroups("makhg2.bam", 3, "ie8", "monster_ankheg");
        expect(hidden?.[0]?.label).toBe("SD - stand (hidden)");
        expect(hidden?.[0]?.id).toBeUndefined();

        const emerged = ieGroups("makhg1.bam", 4, "ie8", "monster_ankheg");
        expect(emerged?.[3]?.id).toBe("stand");
    });

    // A family that spreads its bands over several files numbers them from the packed name, and each of
    // those files still carries the family's whole skeleton.
    test("gives a split file its family's block names", () => {
        expect(ieGroups("chmb1g15.bam", 11, "ie9")?.[5]?.label).toBe("DE - die");
        expect(ieGroups("meaeg21.bam", 7, "ie9")?.[1]?.label).toBe("A2 - attack 2");
        expect(ieGroups("meaeg11e.bam", 6, "ie9")?.[0]?.label).toBe("WK - walk");
    });

    // A shorter file of the same family holds a PREFIX of its blocks: the layout addresses a stance by
    // position, so block 5 is the same stance whether the file stops there or carries three more.
    test("names the shorter files of the fine-scheme family", () => {
        expect(ieGroups("msaig1.bam", 6, "ie9")?.[5]?.label).toBe("TW - twitch");
        expect(ieGroups("migog21.bam", 5, "ie9")?.[4]?.label).toBe("A5 - attack 5");
    });
});
