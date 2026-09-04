import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { type AnimationSet, buildAnimationIndex } from "../src/ie-resources/animation-index";
import type { GameHandle } from "../src/ie-resources/game-handle";
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

    it("reports an id no INI declares rather than guessing its prefix", () => {
        // A classic install ships no animation INIs at all, so this is its every id until the
        // classic-install table is vendored.
        const set = setFor(0xe440);
        expect(set!.scheme.kind).toBe("unimplemented");
        expect(set!.prefixByArmour.size).toBe(0);
    });

    it("is sorted by id, so the gallery's order does not depend on table order", () => {
        const ids = index().map((entry) => entry.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });
});

/** An installed EE game (ships per-animation INIs) and a classic one (ships none). Unset means skip. */
const EE_GAME = process.env.BGFORGE_IE_GAME;
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
