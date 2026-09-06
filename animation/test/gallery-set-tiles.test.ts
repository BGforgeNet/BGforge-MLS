import { describe, expect, it } from "vitest";
import { type AnimationSet, firstArmour } from "../src/animation-index";
import { setPreviewResref, setTile } from "../src/set-tiles";

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

/** The archive answers for whatever the test names; a set's members are decided against it, never assumed. */
const has = (...names: string[]) => {
    const present = new Set(names);
    return (resref: string): boolean => present.has(resref);
};
const nothing = has();

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
        expect(setPreviewResref(cleric, nothing)).toBe("CDMB1G1");
    });

    it("has no preview for a scheme with no layout at all", () => {
        const unknown = setOf({
            id: 0xa000,
            code: "MWYV",
            scheme: { kind: "unimplemented", scheme: 0xa000, reason: "the monster_wyvern scheme..." },
            prefixByArmour: new Map([[1, "MWYV"]]),
        });
        expect(setPreviewResref(unknown, has("MWYVG1"))).toBeUndefined();
    });

    it("stands a non-character layout at the first member the archive answers for", () => {
        const ogre = setOf({
            id: 0x9000,
            scheme: { kind: "unimplemented", scheme: 0x9000, reason: "the monster_large scheme..." },
            layout: "cycles",
            prefixByArmour: new Map([[1, "MOGR"]]),
        });
        // G1 is the first name the layout builds, but this install ships only G2 - the file decides.
        expect(setPreviewResref(ogre, has("MOGRG2"))).toBe("MOGRG2");
    });

    it("has no preview where the layout names nothing the install ships", () => {
        const ogre = setOf({
            id: 0x9000,
            scheme: { kind: "unimplemented", scheme: 0x9000, reason: "the monster_large scheme..." },
            layout: "cycles",
            prefixByArmour: new Map([[1, "MOGR"]]),
        });
        expect(setPreviewResref(ogre, nothing)).toBeUndefined();
    });
});

describe("setTile", () => {
    it("labels a set with the name the creature field would show", () => {
        // ANIMATE's name, not ANISND's code: the link from a creature's animation field lands here, and
        // the two ends must name the same animation the same way.
        expect(setTile(cleric, nothing).label).toBe("CLERIC_MALE_GNOME");
    });

    it("falls back to the code, then to the id, for a set the tables barely name", () => {
        expect(setTile(setOf({ id: 0x6004, code: "CGMC" }), nothing).label).toBe("CGMC");
        expect(setTile(setOf({ id: 0xe440 }), nothing).label).toBe("0xe440");
    });

    /**
     * The facets travel on the tile because the browser filters on them, and their ABSENCE is the load-
     * bearing half: a monster has no race, so a race filter must exclude it rather than match it on a
     * value invented here.
     */
    it("carries a character's facets and leaves a monster without any", () => {
        const facets = { race: "gnome", gender: "male", charClass: "cleric" } as const;
        expect(setTile(setOf({ ...cleric, facets }), nothing).facets).toEqual(facets);
        expect("facets" in setTile(setOf({ id: 0xa000, code: "MWYV" }), nothing)).toBe(false);
    });

    // The three reasons a row draws nothing are different answers to "what do I do about this?", and only
    // the middle one is ours to fix.
    it("says the naming is undeclared - not the animation - and offers the code to search on", () => {
        // Every row that reaches this note IS named by the tables; what is missing is any statement of
        // what its files are called.
        const tile = setTile(
            setOf({
                code: "SPRI",
                name: "FIRE_RING",
                scheme: { kind: "unimplemented", scheme: undefined, reason: "no INI declaration" },
            }),
            nothing,
        );
        expect(tile.unsupported).toBe("Nothing declares which files this animation draws (code SPRI).");
        expect(tile.resref).toBeUndefined();
    });

    it("leaves the code out of that note where the tables name none", () => {
        const tile = setTile(
            setOf({ scheme: { kind: "unimplemented", scheme: undefined, reason: "no INI declaration" } }),
            nothing,
        );
        expect(tile.unsupported).toBe("Nothing declares which files this animation draws.");
    });

    it("keeps the layout's own reason where the layout is the thing we cannot read", () => {
        const tile = setTile(
            setOf({
                prefixByArmour: new Map([[1, "MXXX"]]),
                scheme: { kind: "unimplemented", scheme: undefined, reason: "the moon scheme is not implemented yet" },
            }),
            nothing,
        );
        expect(tile.unsupported).toBe("the moon scheme is not implemented yet");
    });

    it("says the install ships no art where the layout is known and nothing resolves", () => {
        // The common case by far, and the one that used to read as a missing feature: a game's tables name
        // animations belonging to other games in the family.
        const tile = setTile(
            setOf({
                prefixByArmour: new Map([[1, "MBAS"]]),
                layout: "cycles",
                scheme: { kind: "unimplemented", scheme: undefined, reason: "the monster_old scheme is not done" },
            }),
            nothing,
        );
        expect(tile.unsupported).toBe("This install ships no files for this animation.");
    });

    it("drops the reason once a layout resolves, rather than saying so beside a working link", () => {
        const tile = setTile(
            setOf({
                scheme: { kind: "unimplemented", scheme: 0x9000, reason: "the monster_large scheme..." },
                layout: "cycles",
                prefixByArmour: new Map([[1, "MOGR"]]),
            }),
            has("MOGRG1"),
        );
        expect(tile.resref).toBe("MOGRG1");
        expect(tile.unsupported).toBeUndefined();
    });

    it("leaves a drawable set with no reason attached", () => {
        expect(setTile(cleric, nothing).unsupported).toBeUndefined();
    });
});
