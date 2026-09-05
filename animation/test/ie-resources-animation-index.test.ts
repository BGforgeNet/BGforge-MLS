import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { type AnimationSet, buildAnimationIndex, createAnimationIndexResolver } from "../src/animation-index";
import type { GameHandle } from "../src/game-handle";
import { tableForFlavour } from "../src/animation-tables";
import { animationTable } from "../src/animation-tables/table";
import { miniGame } from "./ie-game-fixtures";

const index = (): ReturnType<typeof buildAnimationIndex> => buildAnimationIndex(miniGame());
const setFor = (id: number) => index().find((entry) => entry.id === id);

describe("buildAnimationIndex", () => {
    it("takes the id set from every table, not just one", () => {
        // 0xE440 is named by ANIMATE.IDS and not by ANISND.IDS. An index built from either alone loses
        // one of these, and the creature field that links here resolves through ANIMATE.
        const ids = index().map((entry) => entry.id);
        expect(ids).toContain(0x6000);
        expect(ids).toContain(0xe440);
    });

    it("carries both names, because the two tables answer in different vocabularies", () => {
        const set = setFor(0x6004);
        expect(set?.code).toBe("CGMC");
        expect(set?.name).toBe("CLERIC_MALE_GNOME");
    });

    it("draws under the prefix the INI declares, not under the animation's own code", () => {
        // The gnome cleric's code is CGMC; its body is the dwarf one.
        expect(setFor(0x6004)?.prefixByArmour.get(1)).toBe("CDMB");
    });

    it("splits the prefix at the armour level the INI says it splits", () => {
        const set = setFor(0x6000);
        expect(set?.prefixByArmour.get(1)).toBe("CHMB");
        expect(set?.prefixByArmour.get(3)).toBe("CHMB");
        expect(set?.prefixByArmour.get(4)).toBe("CHMC");
        expect([...set!.prefixByArmour.keys()]).toEqual([1, 2, 3, 4]);
    });

    it("keeps the paperdoll prefix apart from the body", () => {
        expect(setFor(0x6004)?.paperdollPrefix).toBe("CGMC");
        expect(setFor(0x6004)?.prefixByArmour.get(4)).toBe("CDMC");
    });

    it("attaches facets where the id declares them, and none where it does not", () => {
        expect(setFor(0x6004)?.facets).toEqual({ race: "gnome", gender: "male", charClass: "cleric" });
        expect(setFor(0x1000)?.facets).toBeUndefined();
    });

    it("reports an unimplemented scheme rather than dropping it", () => {
        // The whole scheme, unconditionally: narrowing with an `if` would leave the reason unasserted on
        // the very path where the kind is wrong, which is the path worth checking.
        expect(setFor(0xa000)?.scheme).toEqual({
            kind: "unimplemented",
            scheme: 0xa000,
            reason: expect.stringContaining("monster_large16"),
        });
    });

    it("reports an id no INI declares and no table covers rather than guessing its prefix", () => {
        const set = setFor(0xe440);
        expect(set!.scheme.kind).toBe("unimplemented");
        expect(set!.prefixByArmour.size).toBe(0);
    });

    it("is sorted by id, so the gallery's order does not depend on table order", () => {
        const ids = index().map((entry) => entry.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    /**
     * The declared section, kept verbatim.
     *
     * Both derived fields flatten it and neither can be inverted: `scheme` collapses `character` and
     * `character_old` onto one kind, and `layout` collapses `monster_icewind`, `monster_large16` and
     * `multi_new` onto "mixed". A writer emitting a converted set has to name a section in the target's
     * own declaration, so the index has to keep the one it read.
     */
    it("keeps the section the INI declared, which the scheme and layout both flatten", () => {
        expect(setFor(0x6000)?.section).toBe("character");
        expect(setFor(0xa000)?.section).toBe("monster_large16");
    });

    it("leaves the section unset where nothing declares one, rather than inventing a name", () => {
        expect(setFor(0xe440)?.section).toBeUndefined();
    });
});

describe("buildAnimationIndex with a vendored table", () => {
    // A classic install declares nothing, so the table is the only answer for every id it lists.
    const table = animationTable([
        [0xe440, { prefixes: ["MOGR", "MOGR"], section: "monster_large", paperdoll: "MOGRP" }],
        [0x6000, { prefixes: ["XXXX"], section: "character" }],
    ]);
    const withTable = (): AnimationSet[] => buildAnimationIndex(miniGame(), table);
    const tabled = (id: number): AnimationSet | undefined => withTable().find((entry) => entry.id === id);

    it("draws an id the install does not declare under the table's prefixes", () => {
        expect([...tabled(0xe440)!.prefixByArmour]).toEqual([
            [1, "MOGR"],
            [2, "MOGR"],
        ]);
    });

    it("carries the table's paperdoll, which is its own declaration", () => {
        expect(tabled(0xe440)?.paperdollPrefix).toBe("MOGRP");
    });

    it("reports the table's scheme, so a tabled id says what it is rather than that nothing declares it", () => {
        expect(tabled(0xe440)?.scheme).toEqual({
            kind: "unimplemented",
            scheme: undefined,
            reason: expect.stringContaining("monster_large"),
        });
    });

    it("resolves a tabled character scheme, which is what a classic install could not do at all", () => {
        expect(
            buildAnimationIndex(
                miniGame(),
                animationTable([[0xe440, { prefixes: ["CHMB"], section: "character" }]]),
            ).find((entry) => entry.id === 0xe440)?.scheme,
        ).toEqual({ kind: "character" });
    });

    it("prefers the install's own declaration to the table, which is a fallback and not an override", () => {
        // 0x6000 has an INI in the fixture; the table's deliberately wrong prefix must not win.
        expect(tabled(0x6000)?.prefixByArmour.get(1)).toBe("CHMB");
    });

    it("carries a tabled section, so a classic install's rows are as nameable as an INI's", () => {
        expect(tabled(0xe440)?.section).toBe("monster_large");
    });

    /**
     * The one distinction only the section carries. `character_old` names its files exactly as `character`
     * does and resolves to the same scheme kind and the same layout, so a converter reading either derived
     * field cannot tell that this set ships a mirrored twin per member and the other does not.
     */
    it("distinguishes character_old from character, which the scheme kind cannot", () => {
        const set = buildAnimationIndex(
            miniGame(),
            animationTable([[0xe440, { prefixes: ["CHMB"], section: "character_old" }]]),
        ).find((entry) => entry.id === 0xe440);

        expect(set?.section).toBe("character_old");
        expect(set?.scheme).toEqual({ kind: "character" });
    });
});

describe("tableForFlavour", () => {
    it("answers for a classic game and for the expansions that ship its animations", () => {
        expect(tableForFlavour("bg2")).toBe(tableForFlavour("tob"));
        expect(tableForFlavour("bgt")).toBe(tableForFlavour("bg2"));
    });

    it("gives an Enhanced Edition the effect rows and no avatars, since it declares those itself", () => {
        // The effect ids are the ones NO install of the family declares, EE included, so they answer there
        // too - while every avatar keeps coming from the install's own INI.
        for (const flavour of ["bg2ee", "bgee", "sod", "eet"]) {
            const table = tableForFlavour(flavour);
            expect(table?.get(0x0000), flavour).toEqual({ prefixes: ["SPRING"], section: "effect" });
            expect(table?.get(0x6000), flavour).toBeUndefined();
        }
    });

    it("gives a family it carries no rows for nothing at all", () => {
        // Icewind Dale and Planescape have effect ids of their own; no row here was checked against either.
        expect(tableForFlavour("pst")).toBeUndefined();
        expect(tableForFlavour("iwd2")).toBeUndefined();
    });

    it("lets a classic game's own rows override the family-wide effect rows", () => {
        // 0x0410 is in both: the effect set names one file, the rows derived from this game's own
        // declarations name another, and the derived one is the later entry.
        expect(tableForFlavour("tob")?.get(0x0410)?.prefixes).toEqual(["SPGLYPHI"]);
        expect(tableForFlavour("bgee")?.get(0x0410)?.prefixes).toEqual(["GLPHWRDH"]);
    });

    it("carries the Baldur's Gate II character sets, per armour level", () => {
        // The armour split is the fact a single-prefix model gets wrong: three levels then a fourth.
        expect(tableForFlavour("tob")?.get(0x6000)).toEqual({
            prefixes: ["CHMB", "CHMB", "CHMB", "CHMC"],
            section: "character",
            paperdoll: "CHMC",
        });
    });

    it("takes the classic body where the Enhanced Edition added one the classic game has not", () => {
        // Dwarf female: the classic archive ships no CDF* art and draws these under the male body.
        expect(tableForFlavour("tob")?.get(0x6012)?.prefixes).toEqual(["CDMB", "CDMB", "CDMB", "CDMC"]);
    });
});

describe("createAnimationIndexResolver", () => {
    it("builds one index per game directory and answers the rest from it", () => {
        let opened = 0;
        const resolve = createAnimationIndexResolver({
            gameAt: (dir) => {
                opened += 1;
                return dir === "/games/one" ? miniGame() : undefined;
            },
        });

        const first = resolve("/games/one");
        const second = resolve("/games/one");

        expect(first).toBe(second);
        expect(opened).toBe(1);
    });

    it("caches the absence too, so a directory with no game is not reopened per panel", () => {
        let opened = 0;
        const resolve = createAnimationIndexResolver({
            gameAt: () => {
                opened += 1;
                return undefined;
            },
        });

        expect(resolve("/games/none")).toBeUndefined();
        expect(resolve("/games/none")).toBeUndefined();
        expect(opened).toBe(1);
    });

    it("reads a game that throws as having no animations rather than failing the panel", () => {
        const resolve = createAnimationIndexResolver({
            gameAt: () => {
                throw new Error("unreadable archive");
            },
        });

        expect(resolve("/games/broken")).toBeUndefined();
    });
});

/**
 * An installed EE game (ships per-animation INIs) and a classic one (ships none). Unset means skip.
 *
 * The EE half checks the EDITION rather than trusting the variable: the same variable points every other
 * suite here at whatever install is on hand, and a classic one declares no INI - so an unchecked run fails
 * on the install being the wrong kind, which reads as a broken index.
 */
function eeGameDir(dir: string | undefined): string | undefined {
    return dir !== undefined && openGame(dir)?.identity.edition === "ee" ? dir : undefined;
}

const EE_GAME = eeGameDir(process.env.BGFORGE_IE_GAME);
const CLASSIC_GAME = process.env.BGFORGE_IE_GAME_CLASSIC;

function realIndex(dir: string): readonly AnimationSet[] {
    const game = openGame(dir);
    expect(game, `no game at ${dir}`).toBeDefined();
    return buildAnimationIndex(game as unknown as GameHandle);
}

describe.skipIf(EE_GAME === undefined)("over a real EE install", () => {
    it("gives every character set a prefix for each armour level it claims", () => {
        const sets = realIndex(EE_GAME!);
        const characters = sets.filter((set) => set.scheme.kind === "character");
        const broken = characters.filter((set) => set.prefixByArmour.size === 0);
        // Per-scheme counts beside the verdict: a scheme that silently stopped matching would otherwise
        // pass as "no failures".
        expect({ sets: sets.length, characters: characters.length, broken }).toEqual({
            sets: sets.length,
            characters: characters.length,
            broken: [],
        });
        expect(characters.length).toBeGreaterThan(50);
    });

    it("resolves the aliasing set's body and paperdoll to different prefixes", () => {
        const gnome = realIndex(EE_GAME!).find((set) => set.id === 0x6004);
        expect(gnome?.prefixByArmour.get(1)).toBe("CDMB");
        expect(gnome?.prefixByArmour.get(4)).toBe("CDMC");
        expect(gnome?.paperdollPrefix).toBe("CGMC");
    });
});

describe.skipIf(CLASSIC_GAME === undefined)("over a real classic install", () => {
    it("lists its animations and says why each cannot be drawn yet", () => {
        const sets = realIndex(CLASSIC_GAME!);
        expect(sets.length).toBeGreaterThan(100);
        // A classic install ships no animation INIs at all, so every set is unimplemented WITH A REASON -
        // never silently absent, and never a guessed prefix.
        const undeclared = sets.filter((set) => set.scheme.kind !== "unimplemented");
        expect(undeclared).toEqual([]);
        expect(sets.every((set) => set.scheme.kind === "unimplemented" && set.scheme.reason !== "")).toBe(true);
    });
});
