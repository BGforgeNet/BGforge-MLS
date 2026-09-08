import { describe, expect, it } from "vitest";
import { type AnimationSet, armourLevels } from "../src/animation-index";
import { type CharacterFacets } from "../src/animation-facets";
import { actionLabel, armourLabel } from "../src/facet-labels";

function characterSet(id: number, facets: CharacterFacets, prefix: string, levels = 4): AnimationSet {
    const prefixByArmour = new Map<number, string>();
    for (let level = 1; level <= levels; level++) prefixByArmour.set(level, prefix);
    return {
        id,
        code: prefix,
        name: `${facets.charClass}_${facets.gender}_${facets.race}`.toUpperCase(),
        prefixByArmour,
        paperdollPrefix: prefix,
        scheme: { kind: "character" },
        facets,
    };
}

const elfMage: CharacterFacets = { race: "elf", gender: "female", charClass: "mage" };

describe("armourLabel", () => {
    it("names the levels the tables ship", () => {
        expect([1, 2, 3, 4].map((level) => armourLabel(level))).toEqual(["None", "Leather", "Robe", "Plate"]);
    });

    it("numbers a level nothing names", () => {
        expect(armourLabel(7)).toBe("Level 7");
    });
});

describe("actionLabel", () => {
    // Every kind, because the label is the value the view sends BACK when the control changes: a kind
    // whose label nothing produces is a control option that cannot be selected.
    it("names each kind of action the way its control reads", () => {
        expect([
            actionLabel({ kind: "attack", detail: 2 }),
            actionLabel({ kind: "cast" }),
            actionLabel({ kind: "shoot", weapon: "bow" }),
            actionLabel({ kind: "paperdoll" }),
        ]).toEqual(["Attack 2", "Cast", "Shoot (bow)", "Inventory"]);
    });

    /**
     * The misc files each draw one band of the skeleton they share, and that band's meaning is measured - so
     * the control says what the file shows rather than repeating the digit already in its name, in the
     * block's own words so the two surfaces name it identically.
     *
     * Every name is DISTINCT, and that is a requirement rather than an observation: these arrive in the
     * stance picker as consecutive rows, and two reading alike leave the reader picking between them by
     * position. Naming them from the neutral vocabulary does exactly that - three of these are stands.
     */
    it("names a misc file for its own block, distinctly, and numbers one nothing names", () => {
        const labels = [1, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((detail) => actionLabel({ kind: "misc", detail }));

        expect(labels).toEqual([
            "Combat ready (1-handed)",
            "Walk",
            "Stand (1-handed)",
            "Combat ready (2-handed)",
            "Get hit",
            "Die",
            "Twitch",
            "Stand 2",
            "Stand 3",
            "Sleep 1",
        ]);
        expect(new Set(labels).size).toBe(labels.length);
        expect(actionLabel({ kind: "misc", detail: 3 })).toBe("Misc 3");
    });
});

describe("armourLevels", () => {
    it("is the set's own levels, lowest first", () => {
        expect(armourLevels(characterSet(0x6211, elfMage, "CEFW"))).toEqual([1, 2, 3, 4]);
    });

    it("is empty for no set", () => {
        expect(armourLevels(undefined)).toEqual([]);
    });
});
