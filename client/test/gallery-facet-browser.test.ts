import { describe, expect, it } from "vitest";
import { type AnimationSet } from "../src/ie-resources/animation-index";
import { type CharacterFacets } from "../src/ie-resources/animation-facets";
import {
    CLASSES,
    RACES,
    actionLabel,
    armourLevels,
    facetChoices,
    facetIndex,
    resolveFacets,
    setForFacets,
} from "../src/gallery/facet-browser";

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
const humanMage: CharacterFacets = { race: "human", gender: "female", charClass: "mage" };
const elfMonk: CharacterFacets = { race: "elf", gender: "female", charClass: "monk" };

const sets = [
    characterSet(0x6211, elfMage, "CEFW"),
    characterSet(0x6210, humanMage, "CHFW"),
    // A monster: it has no facets, so it must not reach the facet index at all.
    {
        id: 0xa000,
        code: "MWYV",
        name: "WYVERN",
        prefixByArmour: new Map([[1, "MWYV"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "unimplemented" as const, scheme: 0xa000, reason: "not implemented" },
    },
];

const index = facetIndex(sets);
const shipped = new Set(["CEFW2SA", "CEFW2G1", "CEFW1G1", "CHFW2SA"]);
const exists = (resref: string): boolean => shipped.has(resref);

describe("facetIndex", () => {
    it("holds only the sets that carry facets", () => {
        expect(index.size).toBe(2);
        expect(setForFacets(index, elfMage)?.code).toBe("CEFW");
        expect(setForFacets(index, elfMonk)).toBeUndefined();
    });
});

describe("facetChoices", () => {
    it("marks a race available when swapping it in still resolves", () => {
        const races = facetChoices("race", RACES, index, elfMage);
        expect(races.find((choice) => choice.value === "human")?.available).toBe(true);
        expect(races.find((choice) => choice.value === "elf")?.available).toBe(true);
    });

    it("disables an option WITH a reason rather than hiding it", () => {
        // The point of the control: a reader must be able to tell "this game has none" from "the picker
        // forgot about it".
        const dwarf = facetChoices("race", RACES, index, elfMage).find((choice) => choice.value === "dwarf");
        expect(dwarf?.available).toBe(false);
        expect(dwarf?.reason).toContain("dwarf female mage");
    });

    it("re-evaluates a family against the rest of the selection, not in isolation", () => {
        // Monk resolves for nobody here, whatever race is selected.
        const classes = facetChoices("charClass", CLASSES, index, elfMage);
        expect(classes.find((choice) => choice.value === "monk")?.available).toBe(false);
        expect(classes.find((choice) => choice.value === "mage")?.available).toBe(true);
    });
});

describe("resolveFacets", () => {
    it("resolves the worked example to its file", () => {
        const resolved = resolveFacets(index, elfMage, 2, { kind: "shoot", weapon: "bow" }, exists);
        expect(resolved.resref).toBe("CEFW2SA");
        expect(resolved.unavailable).toBeUndefined();
    });

    it("re-resolves to a different id when the race changes", () => {
        const resolved = resolveFacets(index, humanMage, 2, { kind: "shoot", weapon: "bow" }, exists);
        expect(resolved.resref).toBe("CHFW2SA");
        expect(resolved.set?.id).toBe(0x6210);
    });

    it("says why there is no file when the combination has none", () => {
        const resolved = resolveFacets(index, elfMage, 4, { kind: "shoot", weapon: "bow" }, exists);
        expect(resolved.resref).toBeUndefined();
        expect(resolved.unavailable).toContain("shoot (bow)");
    });

    it("says why there is no set when the facets name none", () => {
        const resolved = resolveFacets(index, elfMonk, 1, { kind: "cast" }, exists);
        expect(resolved.set).toBeUndefined();
        expect(resolved.unavailable).toContain("elf female monk");
    });

    it("offers only the actions whose files the install has", () => {
        const resolved = resolveFacets(index, elfMage, 2, { kind: "misc", detail: 1 }, exists);
        expect(resolved.actions.map((action) => actionLabel(action))).toEqual(["Stand", "Shoot (bow)"]);
    });
});

describe("actionLabel", () => {
    // Every kind, because the label is the value the view sends BACK when the control changes: a kind
    // whose label nothing produces is a control option that cannot be selected.
    it("names each kind of action the way its control reads", () => {
        expect([
            actionLabel({ kind: "attack", detail: 2 }),
            actionLabel({ kind: "cast" }),
            actionLabel({ kind: "misc", detail: 1 }),
            actionLabel({ kind: "misc", detail: 3 }),
            actionLabel({ kind: "shoot", weapon: "bow" }),
            actionLabel({ kind: "paperdoll" }),
        ]).toEqual(["Attack 2", "Cast", "Stand", "Misc 3", "Shoot (bow)", "Inventory"]);
    });
});

describe("armourLevels", () => {
    it("is the set's own levels, lowest first", () => {
        expect(armourLevels(setForFacets(index, elfMage))).toEqual([1, 2, 3, 4]);
    });

    it("is empty for no set", () => {
        expect(armourLevels(undefined)).toEqual([]);
    });
});
