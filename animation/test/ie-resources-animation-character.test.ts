import { describe, expect, it } from "vitest";
import {
    characterActions,
    characterDrawsBody,
    characterFileLayout,
    characterMember,
} from "../src/animation-schemes/character";
import { type AnimationSet } from "../src/animation-index";

/**
 * A complete set from the few fields these tests care about.
 *
 * Built rather than cast: a partial `as AnimationSet` typechecks nowhere, and the test runner would not
 * have told us - it strips types instead of checking them.
 */
function setOf(partial: Partial<AnimationSet>): AnimationSet {
    return {
        id: 0,
        code: "",
        name: "",
        prefixByArmour: new Map(),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
        ...partial,
    };
}

/** A cleric set: its levels use two prefixes, so a single-prefix resolver fails against it. */
const cleric = setOf({
    id: 0x6004,
    code: "CGMC",
    name: "CLERIC_MALE_GNOME",
    prefixByArmour: new Map([
        [1, "CDMB"],
        [2, "CDMB"],
        [3, "CDMB"],
        [4, "CDMC"],
    ]),
    paperdollPrefix: "CGMC",
    scheme: { kind: "character" },
});

/** A mage set - four levels, one prefix. The shape every worked example reaches for, and the weakest test. */
const mage = setOf({
    id: 0x6211,
    code: "CEFW",
    name: "MAGE_FEMALE_ELF",
    prefixByArmour: new Map([
        [1, "CEFW"],
        [2, "CEFW"],
        [3, "CEFW"],
        [4, "CEFW"],
    ]),
    paperdollPrefix: "CEFW",
    scheme: { kind: "character" },
});

describe("characterMember", () => {
    it("takes the prefix from the armour level, not from the set", () => {
        expect(characterMember(cleric, 1, { kind: "misc", detail: 1 })).toBe("CDMB1G1");
        expect(characterMember(cleric, 4, { kind: "misc", detail: 1 })).toBe("CDMC4G1");
    });

    it("names the file for elf/female/mage, leather, shoot-bow", () => {
        expect(characterMember(mage, 2, { kind: "shoot", weapon: "bow" })).toBe("CEFW2SA");
    });

    it("distinguishes the three shooting weapons", () => {
        expect(characterMember(mage, 1, { kind: "shoot", weapon: "sling" })).toBe("CEFW1SS");
        expect(characterMember(mage, 1, { kind: "shoot", weapon: "crossbow" })).toBe("CEFW1SX");
    });

    it("numbers attacks and the higher misc cycles", () => {
        expect(characterMember(mage, 1, { kind: "attack", detail: 5 })).toBe("CEFW1A5");
        expect(characterMember(mage, 1, { kind: "misc", detail: 13 })).toBe("CEFW1G13");
        expect(characterMember(mage, 1, { kind: "cast" })).toBe("CEFW1CA");
    });

    it("takes the paperdoll from its own declaration, not from the body", () => {
        // The gnome cleric's body is a dwarf one; only its inventory image carries its own code.
        expect(characterMember(cleric, 1, { kind: "paperdoll" })).toBe("CGMC1INV");
    });

    it("has no member for an armour level the set does not have", () => {
        const monk = setOf({ prefixByArmour: new Map([[1, "CHMM"]]), paperdollPrefix: "CHMM" });
        expect(characterMember(monk, 4, { kind: "cast" })).toBeUndefined();
    });

    it("has no paperdoll where none is declared", () => {
        const bare = setOf({ prefixByArmour: new Map([[1, "CHMB"]]) });
        expect(characterMember(bare, 1, { kind: "paperdoll" })).toBeUndefined();
    });
});

describe("characterActions", () => {
    it("reports only the actions whose files the install actually has", () => {
        const shipped = new Set(["CEFW1G1", "CEFW1A1", "CEFW1SA", "CEFW1CA"]);
        const actions = characterActions(mage, 1, (resref) => shipped.has(resref));
        expect(actions.map((action) => characterMember(mage, 1, action))).toEqual([
            "CEFW1G1",
            "CEFW1A1",
            "CEFW1CA",
            "CEFW1SA",
        ]);
    });

    it("reports nothing for a level the set does not have", () => {
        expect(characterActions(mage, 9, () => true)).toEqual([]);
    });
});

/**
 * The question a vendored table has to be checked against: does this install actually hold what the row
 * names? Its only other exercise is a corpus-gated sweep, so on a machine with no install it went unrun.
 */
describe("characterDrawsBody", () => {
    it("answers yes when the archive holds a body file at any armour level", () => {
        // Only the fourth level's prefix ships, which is why this asks across levels rather than the first.
        expect(characterDrawsBody(cleric, (resref) => resref === "CDMC4G1")).toBe(true);
    });

    /**
     * The paperdoll is keyed by its own prefix, so a set with nothing but an inventory image draws no body.
     * Counting it would mark a row as present on the strength of a picture the creature never animates with.
     */
    it("does not count a paperdoll as a body", () => {
        expect(characterDrawsBody(cleric, (resref) => resref === "CGMC1INV")).toBe(false);
    });

    it("answers no for a set the archive holds nothing of", () => {
        expect(characterDrawsBody(cleric, () => false)).toBe(false);
    });
});

/**
 * The skeleton every character file carries.
 *
 * Measured across a classic and an Enhanced install, per file: a `G` file holds eleven direction bands and
 * draws only the one its digit names, the rest present and empty; a cast file holds the four conjure and
 * release pairs; an attack, a shot and the paperdoll are a single band. A writer that emitted only the drawn
 * band would put the walk where the engine reads the stance.
 */
describe("characterFileLayout", () => {
    it("puts each misc file's art in the band its digit names", () => {
        // G1 is the second band, not the first: the walk is band 0 and lives in G11.
        expect(characterFileLayout("G1")).toEqual({ bands: 11, at: 1 });
        expect(characterFileLayout("G11")).toEqual({ bands: 11, at: 0 });
        expect(characterFileLayout("G12")).toEqual({ bands: 11, at: 2 });
        expect(characterFileLayout("G19")).toEqual({ bands: 11, at: 9 });
    });

    it("gives the cast file the release band of its first spell", () => {
        expect(characterFileLayout("CA")).toEqual({ bands: 8, at: 1 });
    });

    it("gives an attack, a shot and the paperdoll a file of their own band alone", () => {
        expect(characterFileLayout("A1")).toEqual({ bands: 1, at: 0 });
        expect(characterFileLayout("SX")).toEqual({ bands: 1, at: 0 });
        expect(characterFileLayout("INV")).toEqual({ bands: 1, at: 0 });
    });
});
