import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { type AnimationSet, buildAnimationIndex, firstArmour } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { drawnArmourLevels, setMembers, setStances, stanceIo, type StanceIo } from "../src/set-stances";
import type { GameHandle } from "../src/game-handle";
import { bandedPair, multiCycle, packedBands, skeletonBands } from "../../image/test/bam-fixtures.ts";

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

/**
 * What the stance picker reads. One list spans a set's files, so a row names the STANCE and never the file
 * it happens to live in: the file boundary is a packaging convention of the naming family, and the same
 * creature ships as ten single-band files under one family and three packed ones under another.
 *
 * The two-letter code stays out of it. It names a file for a reader holding an archive listing, which is
 * what the block picker over a lone BAM still shows - see `blockLabel`.
 */
describe("stance names", () => {
    function ioFor(files: Record<string, Uint8Array>): StanceIo {
        return { exists: (resref) => Object.hasOwn(files, resref), read: (resref) => files[resref] };
    }

    /** The packed shape: one file, six direction blocks, and the block table saying what each depicts. */
    it("names each block of a packed file, not the file", () => {
        const set: AnimationSet = {
            id: 0x1234,
            code: "MOGH",
            name: "OGRE_MAGE",
            prefixByArmour: new Map([[1, "MOGH"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "cycles",
        };

        const stances = setStances(set, 1, ioFor({ MOGHG1: packedBands(4, 6, [0, 1, 2, 3, 4]) }));

        // The dying band yields two rows at this length: the death, and standing back up by running the
        // same cycles backwards, which is the only get-up a six-block file has.
        expect(stances.map((stance) => stance.label)).toEqual([
            "Walk",
            "Combat ready",
            "Stand",
            "Get hit",
            "Die",
            "Get up",
            "Twitch",
        ]);
    });

    /** The other shape: the stance IS the file, and its suffix is what the family names it by. */
    it("names a single-band file for what it depicts rather than for its suffix", () => {
        const set: AnimationSet = {
            id: 0xe900,
            code: "MSAL",
            name: "SALAMANDER_FIRE",
            prefixByArmour: new Map([[1, "MSAL"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "actions",
        };

        const stances = setStances(set, 1, ioFor({ MSALWK: multiCycle(4, 8), MSALDE: multiCycle(4, 8) }));

        expect(stances.map((stance) => stance.label)).toEqual(["Die", "Walk"]);
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
     * The spell-layered and burrowing families each draw a second set of files the base members never name.
     * They come after the base ones and say which layer they are, since both sets number their cycles alike.
     */
    it("offers a family's second layer after its base members", () => {
        const set = monsterSet({ section: "monster_layered_spell", layerPrefixes: ["MOGHS"] });
        const members = setMembers(set, 1, (resref) => resref === "MOGHG1" || resref === "MOGHSG1");

        expect(members.map((member) => member.resref)).toEqual(["MOGHG1", "MOGHSG1"]);
        expect(members.map((member) => member.label)).toEqual(["G1", "G1 (weapon overlay)"]);
    });

    it("leaves a set with no second layer exactly as it was", () => {
        const set = monsterSet({ section: "monster_layered" });
        expect(setMembers(set, 1, (resref) => resref === "MOGHG1").map((member) => member.label)).toEqual(["G1"]);
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

/**
 * What the io does with a member it cannot read. Both surfaces that draw a set - the gallery's rose and the
 * editor's set document - read through it, so an archive that throws has to degrade the same way for both:
 * a missing row, not a dead page.
 */
describe("stanceIo over an open game", () => {
    /** A partial handle: the io touches only these two methods, where a real game is archive machinery. */
    function gameOf(over: Partial<Pick<GameHandle, "canRead" | "read">>): Pick<GameHandle, "canRead" | "read"> {
        return { canRead: () => true, read: () => multiCycle(4, 8), ...over };
    }

    it("reads a member the archive holds", () => {
        expect(stanceIo(gameOf({})).read("TSTBG1")).toBeDefined();
    });

    it("reads nothing for a member the archive does not hold", () => {
        expect(stanceIo(gameOf({ canRead: () => false })).read("TSTBG1")).toBeUndefined();
    });

    it("reads nothing for a member the archive holds but cannot serve", () => {
        const game = gameOf({
            read: () => {
                throw new Error("corrupt archive entry");
            },
        });
        expect(stanceIo(game).read("TSTBG1")).toBeUndefined();
    });
});

describe("drawnArmourLevels", () => {
    /** The declared count is the family's; a classic archive ships no plate-armoured thief. */
    it("drops a declared level this install has no body files for", () => {
        const set = characterSet();
        set.prefixByArmour = new Map([
            [1, "CDMB"],
            [2, "CDMB"],
            [3, "CDMC"],
        ]);
        expect(drawnArmourLevels(set, (resref) => resref === "CDMB1G1" || resref === "CDMC3G1")).toEqual([1, 3]);
    });

    /**
     * The paperdoll is keyed by its own prefix, so a level whose only surviving file is an inventory image
     * animates nothing - offering it would open a picker with one unplayable row.
     */
    it("does not count a level whose only file is the inventory image", () => {
        const set = characterSet();
        set.paperdollPrefix = "CGMC";
        expect(drawnArmourLevels(set, (resref) => resref === "CGMC1INV")).toEqual([]);
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

    /**
     * The tiled families store eight pictures in their sixteen slots unless they declare a smooth path, so
     * a slot's facing is its pair's - naming the odd ones by half-step points labels art that is not there.
     */
    it("pairs a coarse-path band's slots off rather than naming sixteen distinct facings", () => {
        const set: AnimationSet = {
            id: 0x1100,
            code: "MTAN",
            name: "TANARRI",
            prefixByArmour: new Map([[1, "MTAN"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "cycles",
            bandStride: 16,
            section: "monster_quadrant",
            coarseBands: true,
        };
        const io: StanceIo = { exists: (resref) => resref === "MTANG1", read: () => multiCycle(4, 16) };

        const [stance] = setStances(set, 1, io);

        expect(stance?.slots.map((slot) => slot.facing)).toEqual([
            "S",
            "S",
            "SW",
            "SW",
            "W",
            "W",
            "NW",
            "NW",
            "N",
            "N",
            "NE",
            "NE",
            "E",
            "E",
            "SE",
            "SE",
        ]);
    });

    it("keeps the sixteen distinct facings for a set that declares the smooth path", () => {
        const set: AnimationSet = {
            id: 0x1000,
            code: "MWYV",
            name: "WYVERN",
            prefixByArmour: new Map([[1, "MWYV"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "cycles",
            bandStride: 16,
            section: "monster_quadrant",
        };
        const io: StanceIo = { exists: (resref) => resref === "MWYVG1", read: () => multiCycle(4, 16) };

        const [stance] = setStances(set, 1, io);

        expect(stance?.slots.map((slot) => slot.facing).slice(0, 4)).toEqual(["S", "SSW", "SW", "WSW"]);
    });
});

/**
 * A file whose cycles are not facings at all.
 *
 * Every other reading here cuts a file into direction bands, and a set with no band has no stance - which
 * is a set the viewer cannot open, over files the install ships. The effect families are where this lands:
 * a gib splatter stores ten unrelated pictures, and no direction scheme divides them.
 */
describe("setStances over a file that is not directional", () => {
    /** The shape of an effect set: one file that IS the animation, under no implemented scheme. */
    function effectSet(): AnimationSet {
        return {
            id: 0x0100,
            code: "CHUNKS",
            name: "CHUNKS",
            prefixByArmour: new Map([[1, "SPCHUNKS"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: undefined, reason: "not implemented" },
            layout: "bare",
            section: "effect",
        };
    }

    const chunksIo = (bytes: Uint8Array): StanceIo => ({
        exists: (resref) => resref === "SPCHUNKS",
        read: (resref) => (resref === "SPCHUNKS" ? bytes : undefined),
    });

    it("offers the whole file as one stance, so its cycles are reachable", () => {
        // Ten cycles divide into no scheme's bands, and the reading used to stop there: no band, no stance,
        // and the set refused to open with the message for an install that ships nothing.
        const stances = setStances(effectSet(), 1, chunksIo(multiCycle(4, 10)));

        expect(stances).toHaveLength(1);
        expect(stances[0]?.slots.map((slot) => slot.seqIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("claims no facings for cycles that are not directions", () => {
        // The reading is that there is NO reading - a converter writing a target's direction slots from
        // these would be inventing them, and `inferred` plus a facing-less slot is what says so.
        const [stance] = setStances(effectSet(), 1, chunksIo(multiCycle(4, 10)));

        expect(stance?.slots.every((slot) => slot.facing === "none")).toBe(true);
        expect(stance?.confidence).toBe("inferred");
    });

    it("still lists nothing for a file that holds no cycles at all", () => {
        // The fallback is for a file whose cycles fit no band, never for one with nothing in it: a stance
        // that draws no frame is the empty row the band filter exists to remove.
        expect(setStances(effectSet(), 1, chunksIo(multiCycle(4, 0)))).toEqual([]);
    });
});

/**
 * A band the engine plays for more than one sequence.
 *
 * The huge split-part families share one clip across several stances - a dragon holds the same pose to
 * stand, to square up and while conjuring - and the picker used to name such a band by joining them, so the
 * reader met a row called "Stand, combat ready or conjure spell". That is a sentence about the FILE, not a
 * stance anyone asked to see; the reference browser lists a row per sequence and never has to write one.
 */
describe("setStances over a band several sequences share", () => {
    /** The dragons' shape: a stance group per file family, each tiled across a grid, nine cycles to a band. */
    function dragonSet(): AnimationSet {
        return {
            id: 0x1200,
            code: "MDR1",
            name: "DRAGON_RED",
            prefixByArmour: new Map([[1, "MDR1"]]),
            paperdollPrefix: undefined,
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout: "pieces",
            section: "multi_new",
        };
    }

    /** An archive holding one stance group's tiles and nothing else, so a test names the group it means. */
    const dragonIo = (group: number, bytes: Uint8Array): StanceIo => {
        const holds = (resref: string): boolean => resref.startsWith(`MDR1${group}`);
        return { exists: holds, read: (resref) => (holds(resref) ? bytes : undefined) };
    };

    it("offers a row per sequence rather than one row naming them all", () => {
        const stances = setStances(dragonSet(), 1, dragonIo(2, multiCycle(4, 27)));

        expect(stances.map((stance) => stance.label)).toEqual(["Stand", "Combat ready", "Conjure spell"]);
    });

    it("points every row of a shared band at the same band", () => {
        const stances = setStances(dragonSet(), 1, dragonIo(2, multiCycle(4, 27)));

        expect(stances.map((stance) => stance.band)).toEqual([0, 0, 0]);
    });

    it("gives each row the action its own sequence depicts", () => {
        const stances = setStances(dragonSet(), 1, dragonIo(2, multiCycle(4, 27)));

        expect(stances.map((stance) => stance.action.id)).toEqual(["stand", "ready", "spell"]);
    });

    it("lists the body file's shared band as its three separate stances", () => {
        const stances = setStances(dragonSet(), 1, dragonIo(4, multiCycle(4, 45)));

        expect(stances.map((stance) => stance.label)).toEqual(["Get hit", "Die", "Sleep", "Get up", "Twitch"]);
    });

    /**
     * Getting up is the dying band run backwards - the engine has no clip of its own for it. A row that drew
     * it forwards would be the die row under another name, which is worse than the joined label it replaces:
     * that at least told the reader the three shared one clip.
     */
    it("marks the getting-up row as its band played in reverse", () => {
        const stances = setStances(dragonSet(), 1, dragonIo(4, multiCycle(4, 45)));

        expect(stances.filter((stance) => stance.reversed === true).map((stance) => stance.label)).toEqual(["Get up"]);
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
    /**
     * Every set the picker lists can be opened, at every armour level it offers.
     *
     * A viewer opens a set on its first stance, so a set resolving NONE cannot be opened at all - and it
     * refuses with the message for an install that ships nothing, over files it is holding. That is what a
     * reader met picking CHUNKS: ten cycles no direction scheme divides, so no band, so no stance.
     *
     * This asserted only that SOME sets resolved, which the failing set passes trivially. Every other
     * assertion here measures the QUALITY of the rows a set produced - are they named, do they hold facings
     * - and a set producing NO rows scores perfectly on all of them. Hence a count of the empties, which is
     * the one shape that cannot be satisfied by absence.
     *
     * The levels are the ones the install DRAWS rather than the ones declared: a set whose files this
     * install does not ship is a gap in the install, and the picker says so in its own words.
     */
    it("offers a stance for every set and armour level the install draws", () => {
        const { sets, io } = install();
        const empty: string[] = [];
        let levels = 0;
        for (const set of sets) {
            for (const armour of drawnArmourLevels(set, io.exists)) {
                levels += 1;
                if (setStances(set, armour, io).length === 0) empty.push(`${set.name || set.code} armour ${armour}`);
            }
        }
        process.stdout.write(`  ${levels} drawn armour levels, ${empty.length} offering no stance\n`);
        expect(levels, "no level was exercised, so the assertion below cannot fail").toBeGreaterThan(500);
        expect(empty).toEqual([]);
    });

    /**
     * No stance of a set appears twice.
     *
     * The character family splits one skeleton across ten files and ships each carrying its neighbours'
     * bands as copies, so a list keyed on "any band holding art" offered one death once per file that
     * happened to carry it - three identical rows a reader chose between by position. Nothing else here
     * sees that: every one of those rows is present, named, and drawable.
     *
     * Asserted for the character family, which is the one that splits a skeleton this way. The monster
     * families repeat a label for their own reason - several interchangeable strikes, of which the block
     * tables number all but the first - so they are counted and reported rather than folded in here: a
     * gate that quietly dropped them would report this one clean while saying nothing about that.
     */
    it("offers each stance of a character set once", () => {
        const { sets, io } = install();
        const repeated: string[] = [];
        let elsewhere = 0;
        let listed = 0;
        for (const set of sets) {
            const character = set.scheme.kind === "character";
            for (const armour of drawnArmourLevels(set, io.exists)) {
                const labels = setStances(set, armour, io).map((stance) => stance.label);
                if (character) listed += labels.length;
                const seen = new Set<string>();
                for (const label of labels) {
                    if (!seen.has(label)) seen.add(label);
                    else if (character) repeated.push(`${set.name || set.code} ${armour}: ${label}`);
                    else elsewhere += 1;
                }
            }
        }
        process.stdout.write(`  ${listed} character stances, ${elsewhere} repeats in the other families\n`);
        expect(repeated).toEqual([]);
        expect(listed, "no character stance was exercised, so the assertion above cannot fail").toBeGreaterThan(1000);
    });

    /**
     * A get-up is drawn backwards only where it SHARES the band it comes from.
     *
     * Both halves ship: the dragons have no get-up clip and the engine runs their death in reverse, while
     * the fine monster scheme gives Melissan a get-up block of its own and plays it forwards. A rule keyed
     * on the sequence alone satisfies the first and plays the second backwards, and nothing else here would
     * see it - the row is present, named and drawable either way. Hence the pairing with another sequence
     * on the same band, which is the property that actually differs, plus a floor on each population so the
     * check cannot pass over an install that ships neither.
     *
     * Selected on what the row DEPICTS, which is the only property every family states. Measured against
     * this install: matching the label "Get up" reaches 57 rows, since a family shipping the stance twice
     * numbers both; matching the sequence code reaches 629 but drops every family naming a FILE per action,
     * whose single-band rows carry no code at all. Either key reads as covered while walking a fraction of
     * the population - the failure a guard over a corpus is least able to show you.
     */
    it("reverses a get-up only where it shares the band it is drawn from", () => {
        const { sets, io } = install();
        const stray: string[] = [];
        let reversed = 0;
        let forward = 0;
        for (const set of sets) {
            for (const armour of drawnArmourLevels(set, io.exists)) {
                const stances = setStances(set, armour, io);
                for (const stance of stances.filter((row) => row.action.id === "get-up")) {
                    // Any OTHER row over the same band of the same file. Not "a dying row": the family that
                    // lies a creature down shares its get-up with a sleep, so keying on the death would
                    // report every one of those as a stray.
                    const shares = stances.some(
                        (row) => row !== stance && row.resref === stance.resref && row.band === stance.band,
                    );
                    if (stance.reversed === true) reversed += 1;
                    else forward += 1;
                    if ((stance.reversed === true) !== shares) {
                        stray.push(`${set.name || set.code} ${stance.resref}#${stance.band}`);
                    }
                }
            }
        }
        process.stdout.write(`  ${reversed} get-ups drawn in reverse, ${forward} drawn forwards\n`);
        expect(stray).toEqual([]);
        expect(reversed, "no shared get-up was exercised").toBeGreaterThan(0);
        expect(forward, "no get-up of its own was exercised").toBeGreaterThan(0);
    });

    /**
     * A stance list is supposed to read like a reference browser's - Walk, Die, Attack. A row saying
     * "G2 - group 1" means the block table has not been taught that layout, and nothing else reports it:
     * the numbered form is a legal label, so every other assertion here passes straight over it.
     *
     * The bound is a RATIO over the whole install rather than a list of the sections still missing, so a
     * newly-taught family tightens it without anyone editing an inventory. It was 358 unnamed stances when
     * a reader found a red dragon listing fourteen numbered rows; what is left is `effect`, the one type
     * the documentation gives no sequence layout at all, so this cannot reach zero and should not pretend
     * it can.
     */
    it("names all but a small remainder of the install's stances", () => {
        const { sets, io } = install();
        const numbered: string[] = [];
        let total = 0;
        for (const set of sets) {
            const armour = firstArmour(set);
            if (armour === undefined) continue;
            for (const stance of setStances(set, armour, io)) {
                total += 1;
                if (/ - group \d+$/.test(stance.label)) numbered.push(`${set.name || set.code}: ${stance.label}`);
            }
        }
        process.stdout.write(`  ${numbered.length}/${total} stances fall back to a number\n`);
        expect(total, "no stance was exercised, so the ratio below cannot fail").toBeGreaterThan(500);
        expect(numbered.length / total).toBeLessThan(0.005);
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
    // G1 opens on a block no sequence addresses. It also draws a SECOND set of files under the same scheme,
    // so the same eight blocks come back twice and only the layer tells the runs apart.
    it("names the burrowing scheme's blocks and leaves out the one it addresses nothing to", () => {
        const { sets, io } = install();
        const set = sets.find((candidate) => candidate.section === "monster_ankheg");
        if (set === undefined) return; // an install without the section proves nothing either way
        const armour = firstArmour(set);
        expect(armour, `${set.code} declares no prefix`).toBeDefined();
        // Stance NAMES, not the block picker's coded form: a stance list spans a set's files and never
        // shows the code that addresses one inside a file.
        const blocks = ["Die", "Twitch", "Stand (emerged)", "Stand (hidden)", "Emerge", "Hide", "Attack", "Cast spell"];

        const stances = setStances(set, armour!, io);

        expect(stances.map((stance) => stance.label)).toEqual([
            ...blocks,
            ...blocks.map((label) => `${label} (second piece)`),
        ]);
        // Every one draws all eight facings, which takes the eastern twin: the base file stores five.
        //
        // The second piece included, and it is the case that needs saying: it is a still per facing, so
        // nothing in its own files varies for the block reader to cut on. Its geometry comes from the
        // member it overlays, which is what an overlay is drawn against.
        expect(stances.map((stance) => stance.slots.length)).toEqual(
            Array.from({ length: blocks.length * 2 }, () => 8),
        );
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
