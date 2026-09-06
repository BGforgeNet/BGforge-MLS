import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { type AnimationSet, buildAnimationIndex, firstArmour } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { setMembers, setStances, type StanceIo } from "../src/set-stances";
import { bandedPair, multiCycle, skeletonBands } from "../../image/test/bam-fixtures.ts";

const GAME = process.env.BGFORGE_IE_GAME;

/** A character set at one armour level, which is the shape both character layouts resolve through. */
function characterSet(): AnimationSet {
    return {
        id: 0x6004,
        code: "CGMC",
        name: "CLERIC_MALE_GNOME",
        prefixByArmour: new Map([[1, "CDMB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
    };
}

/** Answers with a real eight-cycle BAM for whichever resrefs the test names, and nothing for the rest. */
function archiveOf(...names: string[]): StanceIo {
    const present = new Set(names);
    const bytes = multiCycle(4, 8);
    return {
        exists: (resref) => present.has(resref),
        read: (resref) => (present.has(resref) ? bytes : undefined),
    };
}

describe("setStances over the character layouts", () => {
    it("draws a stance from the one file a character action normally ships", () => {
        const stances = setStances(characterSet(), 1, archiveOf("CDMB1G1"));
        expect(stances.map((stance) => stance.parts)).toEqual([["CDMB1G1"]]);
    });

    it("adds the older layout's mirrored twin to the same stance rather than listing it separately", () => {
        // The `E` file holds the facings the engine mirrors for everyone else, so it is a PART of the
        // action - a second row for it would offer the reader half a rose.
        const stances = setStances(characterSet(), 1, archiveOf("CDMB1G1", "CDMB1G1E"));
        expect(stances.map((stance) => stance.parts)).toEqual([["CDMB1G1", "CDMB1G1E"]]);
    });

    // The shape the action-code sections ship: the base file stops at the five western facings, and the
    // twin's own table runs past it to the positions the eastern three sit at. Reading the base's table as
    // the member's would compose away exactly the facings the twin exists to supply.
    it("reads a member over the twin's longer table where the base file stops short", () => {
        const base = multiCycle(4, 5);
        const twin = bandedPair(4, [5, 6, 7]);
        const io: StanceIo = {
            exists: (resref) => resref === "CDMB1G1" || resref === "CDMB1G1E",
            read: (resref) => (resref === "CDMB1G1" ? base : resref === "CDMB1G1E" ? twin : undefined),
        };
        expect(setStances(characterSet(), 1, io)[0]?.slots).toHaveLength(8);
    });

    it("lists no stance for a file the archive cannot read", () => {
        const io: StanceIo = { exists: () => true, read: () => new Uint8Array([1, 2, 3]) };
        expect(setStances(characterSet(), 1, io)).toEqual([]);
    });

    it("bands a member as its whole picture, so the twin's facings become slots of the same stance", () => {
        // The base file pads the three eastern facings and the twin draws them. Banding the base alone
        // reports five - which is what the reader would then see, with the twin's art unreachable.
        const base = bandedPair(4, [0, 1, 2, 3, 4]);
        const twin = bandedPair(4, [5, 6, 7]);
        const io: StanceIo = {
            exists: (resref) => resref === "CDMB1G1" || resref === "CDMB1G1E",
            read: (resref) => (resref === "CDMB1G1" ? base : resref === "CDMB1G1E" ? twin : undefined),
        };
        expect(setStances(characterSet(), 1, io)[0]?.slots.map((slot) => slot.facing)).toEqual([
            "S",
            "SW",
            "W",
            "NW",
            "N",
            "NE",
            "E",
            "SE",
        ]);
    });

    /**
     * The band skeleton every character file carries. Only one of its bands holds art; the rest exist so
     * the engine finds the drawn one at the position its name promises.
     *
     * Listing them all is what the reader did, and the cost was not cosmetic: ten files x eleven bands made
     * a hundred-odd stances of which ten drew anything, and a conversion then reported a loss for every one
     * of the empties. The band's INDEX survives the filtering, because that is what addresses it in the file.
     */
    it("lists only the bands that hold art, at the index they sit in", () => {
        const skeleton = skeletonBands(4, 11, 1, [0, 1, 2, 3, 4]);
        const io: StanceIo = { exists: (resref) => resref === "CDMB1G1", read: () => skeleton };

        const stances = setStances(characterSet(), 1, io);

        expect(stances.map((stance) => stance.band)).toEqual([1]);
        expect(stances[0]?.slots.length).toBeGreaterThan(0);
    });

    it("keeps the base file's own stored arc where no twin ships", () => {
        const base = bandedPair(4, [0, 1, 2, 3, 4]);
        const io: StanceIo = { exists: (resref) => resref === "CDMB1G1", read: () => base };
        expect(setStances(characterSet(), 1, io)[0]?.slots.map((slot) => slot.facing)).toEqual([
            "S",
            "SW",
            "W",
            "NW",
            "N",
        ]);
    });
});

describe("setMembers", () => {
    /** A monster set: its files are named by the scheme's own suffixes rather than by armour and action. */
    function monsterSet(overrides: Partial<AnimationSet> = {}): AnimationSet {
        return {
            id: 0x1234,
            code: "MOGH",
            name: "OGRE_MAGE",
            prefixByArmour: new Map([[1, "MOGH"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "cycles",
            ...overrides,
        };
    }

    it("names a non-character set's files from its layout", () => {
        const members = setMembers(monsterSet(), 1, (resref) => resref === "MOGHG1" || resref === "MOGHG3");
        expect(members.map((member) => member.resref)).toEqual(["MOGHG1", "MOGHG3"]);
    });

    /**
     * A set the index could not give a layout to draws nothing, rather than falling through to a default
     * scheme: a guessed naming scheme resolves to files that either do not exist or belong to another set.
     */
    it("names nothing for a set with no layout", () => {
        expect(setMembers(monsterSet({ layout: undefined }), 1, () => true)).toEqual([]);
    });

    it("names one member per action for a character set", () => {
        const members = setMembers(characterSet(), 1, (resref) => resref === "CDMB1G1");
        expect(members.map((member) => member.resref)).toEqual(["CDMB1G1"]);
    });
});

describe("setStances with a declared stride", () => {
    /**
     * A set whose declared type fixes its cycles-per-direction is banded at that stride rather than by
     * reading block structure - which is the only way a file whose structure is ambiguous bands correctly.
     */
    it("bands at the stride the set declares", () => {
        const set: AnimationSet = {
            id: 0x1234,
            code: "MOGH",
            name: "OGRE_MAGE",
            prefixByArmour: new Map([[1, "MOGH"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "cycles",
            bandStride: 8,
        };
        const io: StanceIo = { exists: (resref) => resref === "MOGHG1", read: () => multiCycle(4, 16) };

        const stances = setStances(set, 1, io);

        expect(stances.map((stance) => stance.band)).toEqual([0, 1]);
        expect(stances.every((stance) => stance.confidence === "declared")).toBe(true);
    });
});

/** Built per test, not in the describe body: `skipIf` still evaluates the body, so opening a game there
 *  throws during collection on every machine that has no install. */
function install(): { sets: AnimationSet[]; io: StanceIo } {
    const game = openGame(GAME!);
    if (game === undefined) throw new Error(`no game at ${GAME}`);
    return {
        sets: buildAnimationIndex(game, tableForFlavour(game.identity.flavour)),
        io: {
            exists: (resref) => game.canRead(resref, "bam"),
            read: (resref) => (game.canRead(resref, "bam") ? game.read(resref, "bam") : undefined),
        },
    };
}

describe.skipIf(GAME === undefined)("setStances over a real install", () => {
    it("resolves stances for most sets whose files the install ships", () => {
        const { sets, io } = install();
        let drawable = 0;
        let resolved = 0;
        for (const set of sets) {
            const armour = firstArmour(set);
            if (armour === undefined) continue;
            drawable += 1;
            if (setStances(set, armour, io).length > 0) resolved += 1;
        }
        process.stdout.write(`  stances resolved for ${resolved}/${drawable} sets with a declared prefix\n`);
        expect(drawable, "no set declared a prefix, so nothing was exercised").toBeGreaterThan(0);
        expect(resolved).toBeGreaterThan(0);
    });

    it("gives every stance a band that actually holds facings", () => {
        const { sets, io } = install();
        for (const set of sets) {
            const armour = firstArmour(set);
            if (armour === undefined) continue;
            for (const stance of setStances(set, armour, io)) {
                expect(stance.slots.length, `${stance.resref} band ${stance.band}`).toBeGreaterThan(0);
                expect(stance.label.length, `${stance.resref} band ${stance.band}`).toBeGreaterThan(0);
            }
        }
    });

    // The burrowing set is the one whose whole shape is documented and whose own files contradict the
    // structural key: three blocks of an eight-wide G2 are another family's attacks under that key, and its
    // G1 opens on a block no sequence addresses.
    it("names the burrowing scheme's blocks and leaves out the one it addresses nothing to", () => {
        const { sets, io } = install();
        const set = sets.find((candidate) => candidate.section === "monster_ankheg");
        if (set === undefined) return; // an install without the section proves nothing either way
        const armour = firstArmour(set);
        expect(armour, `${set.code} declares no prefix`).toBeDefined();

        const stances = setStances(set, armour!, io);

        expect(stances.map((stance) => stance.label)).toEqual([
            "DE - die",
            "TW - twitch",
            "SD - stand",
            "SC - combat stance",
            "EMERGE - emerge",
            "HIDE - burrow",
            "A1 - attack",
            "CA - cast",
        ]);
        // Every one draws all eight facings, which takes the eastern twin: the base file stores five.
        expect(stances.map((stance) => stance.slots.length)).toEqual(Array.from({ length: 8 }, () => 8));
    });

    it("names most stances from the schemes' own block tables rather than numbering them", () => {
        const { sets, io } = install();
        let named = 0;
        let numbered = 0;
        for (const set of sets) {
            const armour = firstArmour(set);
            if (armour === undefined) continue;
            for (const stance of setStances(set, armour, io)) {
                if (/ - group \d+$/.test(stance.label)) numbered += 1;
                else named += 1;
            }
        }
        process.stdout.write(`  ${named} stances named from a block table, ${numbered} numbered\n`);
        expect(named + numbered, "no stance resolved, so nothing was exercised").toBeGreaterThan(0);
        // The numbered remainder is the sixteen-wide sections, which no block table names; anything close
        // to half would mean a token or a section key stopped matching.
        expect(numbered).toBeLessThan(named / 4);
    });

    it("never lists a stance whose file the archive lacks", () => {
        const { sets, io } = install();
        for (const set of sets) {
            const armour = firstArmour(set);
            if (armour === undefined) continue;
            for (const stance of setStances(set, armour, io)) {
                expect(io.exists(stance.resref), `${stance.resref} listed but absent`).toBe(true);
            }
        }
    });
});
