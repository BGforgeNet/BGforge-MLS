import { describe, expect, it } from "vitest";
import { type AnimationSet } from "../src/ie-resources/animation-index";
import { firstArmour, setPreviewResref, setTile } from "../src/gallery/set-tiles";

function setOf(partial: Partial<AnimationSet>): AnimationSet {
    return {
        id: 0x6000,
        code: "",
        name: "",
        prefixByArmour: new Map(),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
        ...partial,
    };
}

const cleric = setOf({
    id: 0x6004,
    code: "CGMC",
    name: "CLERIC_MALE_GNOME",
    prefixByArmour: new Map([
        [2, "CDMB"],
        [1, "CDMB"],
        [4, "CDMC"],
    ]),
});

describe("firstArmour", () => {
    it("is the lowest level the set has, whatever order the map was built in", () => {
        expect(firstArmour(cleric)).toBe(1);
    });

    it("is undefined for a set with no levels", () => {
        expect(firstArmour(setOf({}))).toBeUndefined();
    });
});

describe("setPreviewResref", () => {
    it("stands the set at its lowest armour level", () => {
        expect(setPreviewResref(cleric)).toBe("CDMB1G1");
    });

    it("has no preview for a scheme this build cannot name files for", () => {
        const wyvern = setOf({
            id: 0xa000,
            code: "MWYV",
            scheme: { kind: "unimplemented", scheme: 0xa000, reason: "the monster_large16 scheme..." },
            prefixByArmour: new Map([[1, "MWYV"]]),
        });
        expect(setPreviewResref(wyvern)).toBeUndefined();
    });
});

describe("setTile", () => {
    it("labels a set with the name the creature field would show", () => {
        // ANIMATE's name, not ANISND's code: the link from a creature's animation field lands here, and
        // the two ends must name the same animation the same way.
        expect(setTile(cleric).label).toBe("CLERIC_MALE_GNOME");
    });

    it("falls back to the code, then to the id, for a set the tables barely name", () => {
        expect(setTile(setOf({ id: 0x6004, code: "CGMC" })).label).toBe("CGMC");
        expect(setTile(setOf({ id: 0xe440 })).label).toBe("0xe440");
    });

    it("carries the reason a set cannot be drawn, so the tile can say so", () => {
        const tile = setTile(
            setOf({ scheme: { kind: "unimplemented", scheme: undefined, reason: "no INI declaration" } }),
        );
        expect(tile.unsupported).toBe("no INI declaration");
        expect(tile.resref).toBeUndefined();
    });

    it("leaves a drawable set with no reason attached", () => {
        expect(setTile(cleric).unsupported).toBeUndefined();
    });
});
