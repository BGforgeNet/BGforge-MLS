import { describe, expect, it } from "vitest";
import { type AnimationSet } from "../src/ie-resources/animation-index";
import { type CharacterFacets } from "../src/ie-resources/animation-facets";
import { facetIndex } from "../src/gallery/facet-browser";
import {
    createFacetBrowser,
    DEFAULT_SELECTION,
    facetState,
    type FacetSelection,
    selectFacet,
} from "../src/gallery/facet-state";

function characterSet(id: number, facets: CharacterFacets, prefix: string, levels: number[]): AnimationSet {
    return {
        id,
        code: prefix,
        name: `${facets.charClass}_${facets.gender}_${facets.race}`.toUpperCase(),
        prefixByArmour: new Map(levels.map((level) => [level, prefix])),
        paperdollPrefix: prefix,
        scheme: { kind: "character" },
        facets,
    };
}

const elfMage: CharacterFacets = { race: "elf", gender: "female", charClass: "mage" };
const humanMage: CharacterFacets = { race: "human", gender: "female", charClass: "mage" };

// The human set has one armour level; the elf set has four. Moving between them must re-seat the armour.
const index = facetIndex([
    characterSet(0x6211, elfMage, "CEFW", [1, 2, 3, 4]),
    characterSet(0x6210, humanMage, "CHFW", [1]),
]);

const shipped = new Set(["CEFW1G1", "CEFW2G1", "CEFW2SA", "CHFW1G1"]);
const exists = (resref: string): boolean => shipped.has(resref);

const elfSelection: FacetSelection = { ...elfMage, armour: 2, action: { kind: "shoot", weapon: "bow" } };

describe("facetState", () => {
    it("reports the file the selection resolves to", () => {
        expect(facetState(index, elfSelection, exists).resref).toBe("CEFW2SA");
    });

    it("offers only the armour levels the resolved set has", () => {
        expect(facetState(index, elfSelection, exists).armours.map((a) => a.value)).toEqual(["1", "2", "3", "4"]);
    });

    it("offers only the actions whose files exist at this level", () => {
        expect(facetState(index, elfSelection, exists).actions.map((a) => a.label)).toEqual(["Stand", "Shoot (bow)"]);
    });

    it("keeps an unavailable race in the list, with its reason", () => {
        const dwarf = facetState(index, elfSelection, exists).races.find((r) => r.value === "dwarf");
        expect(dwarf).toEqual({
            value: "dwarf",
            label: "Dwarf",
            available: false,
            reason: expect.stringContaining("dwarf female mage"),
        });
    });

    it("says why nothing resolves when the facets name no set", () => {
        const state = facetState(index, { ...DEFAULT_SELECTION }, exists);
        expect(state.resref).toBeUndefined();
        expect(state.unavailable).toContain("human male fighter");
    });
});

describe("selectFacet", () => {
    it("re-resolves to a different id when the race changes", () => {
        const next = selectFacet(index, elfSelection, "race", "human", exists);
        expect(next.race).toBe("human");
        expect(facetState(index, next, exists).resref).toBe("CHFW1G1");
    });

    it("re-seats the armour when the new set does not have the old level", () => {
        // The elf set is at level 2; the human set only has level 1. Carrying 2 over would resolve to a
        // file that does not exist and read as a missing animation.
        const next = selectFacet(index, elfSelection, "race", "human", exists);
        expect(next.armour).toBe(1);
    });

    it("re-seats the action when the new selection does not ship the old one", () => {
        const next = selectFacet(index, elfSelection, "race", "human", exists);
        expect(next.action).toEqual({ kind: "misc", detail: 1 });
    });

    it("moves the armour level within one set", () => {
        const next = selectFacet(index, elfSelection, "armour", "1", exists);
        expect(next.armour).toBe(1);
        expect(facetState(index, next, exists).resref).toBe("CEFW1G1");
    });

    it("moves the action within one set", () => {
        const next = selectFacet(
            index,
            { ...elfSelection, action: { kind: "misc", detail: 1 } },
            "action",
            "Shoot (bow)",
            exists,
        );
        expect(facetState(index, next, exists).resref).toBe("CEFW2SA");
    });
});

describe("createFacetBrowser", () => {
    // The seam the panel holds: it binds the index and the existence check once, so the panel answers a
    // control change without knowing how a facet resolves to a file.
    const sets = [characterSet(0x6211, elfMage, "CEFW", [1, 2, 3, 4]), characterSet(0x6210, humanMage, "CHFW", [1])];

    it("answers a selection with the file it resolves to", () => {
        expect(createFacetBrowser(sets, exists).state(elfSelection).resref).toBe("CEFW2SA");
    });

    it("moves a control and re-seats the rest of the selection", () => {
        expect(createFacetBrowser(sets, exists).select(elfSelection, "race", "human")).toEqual({
            ...humanMage,
            armour: 1,
            action: { kind: "misc", detail: 1 },
        });
    });
});
