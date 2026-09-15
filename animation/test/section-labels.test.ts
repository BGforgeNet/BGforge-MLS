import { describe, expect, it } from "vitest";
import { familyDescription, sectionLabel, sectionOptions } from "../src/facet-labels";
import { BG2_TABLE } from "../src/animation-tables/bg2";

describe("sectionLabel", () => {
    it("spells the declared families a reader recognises", () => {
        expect(sectionLabel("character")).toBe("Character");
        expect(sectionLabel("monster_quadrant")).toBe("Monster, quadrants");
        expect(sectionLabel("multi_new")).toBe("Multi-part");
    });

    /**
     * The guard, not a second copy of the list: a section the shipped table declares and this does not
     * name would show a reader the raw `monster_large16` token, which is the tell that the label map went
     * stale against a table edit. Only the TABLE's sections are pinned - an install's INI header is an
     * open vocabulary, which is what the fallback below is for.
     */
    it("names every section the shipped table declares", () => {
        const declared = new Set<string>();
        for (const animation of BG2_TABLE.values()) if (animation.section) declared.add(animation.section);

        expect(declared.size).toBeGreaterThan(0);
        expect([...declared].filter((section) => sectionLabel(section) === section)).toEqual([]);
    });

    /** An install may declare a section header nobody has seen; showing its own word beats showing none. */
    it("keeps a section it does not know as the install's own word", () => {
        expect(sectionLabel("monster_hypothetical")).toBe("monster_hypothetical");
    });
});

describe("sectionOptions", () => {
    /**
     * What a writer OFFERS, so it is the labelled families and nothing else: a picker built from this is
     * how a declaration gets a header an engine reads instead of whatever was typed into a box.
     */
    it("offers every labelled family, each already spelled", () => {
        const offered = sectionOptions();

        expect(offered).toContainEqual({ id: "character", label: "Character" });
        expect(offered).toContainEqual({ id: "monster_layered_spell", label: "Monster, layered spell" });
        expect(offered.every((entry) => entry.label === sectionLabel(entry.id))).toBe(true);
    });

    /** Every section the shipped table declares is one this can be picked from, not just one it can spell. */
    it("covers every section the shipped table declares", () => {
        const offered = new Set(sectionOptions().map((entry) => entry.id));
        const declared = [...BG2_TABLE.values()].flatMap((animation) => animation.section ?? []);

        expect(declared.length).toBeGreaterThan(0);
        expect(declared.filter((section) => !offered.has(section))).toEqual([]);
    });
});

describe("familyDescription", () => {
    /**
     * The label alone answers nothing: "Monster, layered spell" is the install's own words for a family,
     * and a reader meeting it wants to know which engine says so and what the files look like.
     */
    it("names the engine, the install's own token and what the files are", () => {
        const described = familyDescription("monster_layered_spell", "cycles");

        expect(described).toContain("Infinity Engine");
        expect(described).toContain("monster_layered_spell");
        expect(described).toContain("one file per numbered cycle");
    });

    /** Two of these families draw a second set of files over the first, which is what makes them layered. */
    it("says what a layered family draws over the body", () => {
        expect(familyDescription("monster_layered_spell", "cycles")).toContain("weapon overlay");
        expect(familyDescription("monster_ankheg", "cycles")).toContain("second piece");
    });

    it("says nothing about overlays for a family that draws none", () => {
        expect(familyDescription("character", "character")).not.toMatch(/overlay|second piece/);
    });

    /** A set the install declares but whose layout nothing resolved still names the engine and the token. */
    it("describes a family whose layout is unresolved", () => {
        const described = familyDescription("monster_hypothetical", undefined);

        expect(described).toContain("Infinity Engine");
        expect(described).toContain("monster_hypothetical");
    });
});
