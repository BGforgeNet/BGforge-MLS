/**
 * Which replacement colour table a member draws under.
 *
 * The declaration is one name, but the tiled families store a table PER STANCE GROUP and number them, so
 * the name a member actually reads is the declared one plus the group digit its own filename carries.
 */
import { describe, expect, it } from "vitest";
import type { AnimationSet } from "../src/animation-index";
import { replacementPaletteNames } from "../src/set-palette";

function setWith(fields: Partial<AnimationSet>): AnimationSet {
    return {
        id: 0x1203,
        code: "",
        name: "DRAGON_GREEN",
        prefixByArmour: new Map([[1, "MDR1"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "layout" },
        ...fields,
    };
}

describe("replacementPaletteNames", () => {
    it("names none where the animation declares none", () => {
        expect(replacementPaletteNames(setWith({}), "MDR11100", 1)).toEqual([]);
    });

    /**
     * `MDR11100` is stance group 1 of `MDR1`, and the install ships `MDR1_GR1`..`MDR1_GR5` rather than a
     * single `MDR1_GR` - so the digit after the prefix is what picks the table.
     */
    it("numbers a tiled member's table with the stance group its filename carries", () => {
        const set = setWith({ layout: "mixed", newPalette: "MDR1_GR" });

        expect(replacementPaletteNames(set, "MDR11100", 1)).toEqual(["MDR1_GR1", "MDR1_GR"]);
        expect(replacementPaletteNames(set, "MDR15110", 1)).toEqual(["MDR1_GR5", "MDR1_GR"]);
    });

    /**
     * Every other layout puts a letter there - `G` for a cycle or quadrant member, the first letter of an
     * action code for the rest - and those families ship the bare name.
     */
    it("leaves the declared name alone where the character after the prefix is not a group digit", () => {
        const cycles = setWith({ prefixByArmour: new Map([[1, "MBER"]]), layout: "cycles", newPalette: "MBER_BL" });
        const quadrant = setWith({ prefixByArmour: new Map([[1, "MWYV"]]), layout: "quadrant", newPalette: "MWYV_WH" });

        expect(replacementPaletteNames(cycles, "MBERG1", 1)).toEqual(["MBER_BL"]);
        expect(replacementPaletteNames(quadrant, "MWYVG11", 1)).toEqual(["MWYV_WH"]);
    });

    /**
     * Five is the last group a tiled animation stores, so a higher digit names no table. The member below
     * is constructed rather than taken from an install - no shipped animation has a sixth group.
     */
    it("stops numbering past the fifth stance group", () => {
        const set = setWith({ layout: "mixed", newPalette: "MDR1_GR" });

        expect(replacementPaletteNames(set, "MDR16100", 1)).toEqual(["MDR1_GR"]);
    });

    it("leaves the declared name alone where the level names no prefix to measure from", () => {
        const set = setWith({ prefixByArmour: new Map(), newPalette: "MDR1_GR" });

        expect(replacementPaletteNames(set, "MDR11100", 1)).toEqual(["MDR1_GR"]);
    });
});
