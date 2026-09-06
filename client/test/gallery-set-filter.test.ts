/**
 * The animation list's filters.
 *
 * Worth its own test because the interesting cases are all absences: a corpus whose sets carry no facets at
 * all (Fallout), a set that is not a character (a monster in an IE install), and a value that stops being on
 * offer once another filter moves.
 */
import { describe, expect, it } from "vitest";
import { type SetTile } from "../src/gallery/webview/messages";
import {
    ANY,
    ANY_SELECTION,
    type FilterSelection,
    filterControls,
    filterSets,
} from "../src/gallery/webview/set-filter";

function tile(id: number, facets?: SetTile["facets"]): SetTile {
    return { id, label: `set ${id}`, resref: `S${id}`, unsupported: undefined, ...(facets ? { facets } : {}) };
}

const ELF_F_MAGE = tile(1, { race: "elf", gender: "female", charClass: "mage" });
const HUMAN_M_MAGE = tile(2, { race: "human", gender: "male", charClass: "mage" });
const HUMAN_M_THIEF = tile(3, { race: "human", gender: "male", charClass: "thief" });
/** A monster: a real animation with no race or class to it. */
const MONSTER = tile(4);

const CHARACTERS = [ELF_F_MAGE, HUMAN_M_MAGE, HUMAN_M_THIEF, MONSTER];

const select = (over: Partial<FilterSelection>): FilterSelection => ({ ...ANY_SELECTION, ...over });

describe("filterSets", () => {
    it("offers everything, monsters included, while every filter is ANY", () => {
        expect(filterSets(CHARACTERS, ANY_SELECTION)).toEqual(CHARACTERS);
    });

    it("drops the sets that do not carry the value", () => {
        expect(filterSets(CHARACTERS, select({ race: "human" }))).toEqual([HUMAN_M_MAGE, HUMAN_M_THIEF]);
    });

    it("narrows on every filter at once, not the last one set", () => {
        expect(filterSets(CHARACTERS, select({ race: "human", charClass: "thief" }))).toEqual([HUMAN_M_THIEF]);
    });

    /** Not a set with an unknown race: a monster HAS no race, so a race filter is not a question about it. */
    it("excludes a set with no facets as soon as any filter is set", () => {
        expect(filterSets([MONSTER], select({ gender: "male" }))).toEqual([]);
    });
});

describe("filterControls", () => {
    it("offers ANY plus the values the corpus actually holds", () => {
        const [race] = filterControls(CHARACTERS, ANY_SELECTION);
        expect(race?.options.map((option) => option.value)).toEqual([ANY, "elf", "human"]);
        expect(race?.options[1]?.label).toBe("Elf");
    });

    /**
     * A Fallout install: nothing in it declares a race, gender or class, so none of the three is a choice
     * the reader could make. They stay visible at ANY rather than becoming empty dropdowns.
     */
    it("marks every family inapplicable where no set carries facets", () => {
        const controls = filterControls([MONSTER], select({ race: "human" }));
        expect(controls.map((control) => control.applicable)).toEqual([false, false, false]);
        expect(controls.map((control) => control.value)).toEqual([ANY, ANY, ANY]);
    });

    /** The options a family offers depend on the OTHER filters, so narrowing never leads to an empty list. */
    it("offers only the values the other filters leave", () => {
        const controls = filterControls(CHARACTERS, select({ charClass: "thief" }));
        const race = controls.find((control) => control.family === "race");
        expect(race?.options.map((option) => option.value)).toEqual([ANY, "human"]);
    });

    it("falls back to ANY for a value the other filters no longer offer", () => {
        const controls = filterControls(CHARACTERS, select({ race: "elf", charClass: "thief" }));
        expect(controls.find((control) => control.family === "race")?.value).toBe(ANY);
    });
});
