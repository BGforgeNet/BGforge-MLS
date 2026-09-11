import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { layoutOf } from "../src/animation-schemes/layout";
import { layerPrefixes } from "../src/animation-schemes/layers";
import { schemeMembers } from "../src/animation-schemes/members";
import { parseAnimationIni } from "../src/animation-ini";
import { buildAnimationIndex } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { setTile } from "../src/set-tiles";
import { drawnArmourLevels, setStances, stanceIo } from "../src/set-stances";

const GAME = process.env.BGFORGE_IE_GAME;

/** What a `G`-numbered member depicts: nothing anything has pinned, under the code its name carries. */
const cycleAction = (code: string) => ({ scheme: "cycle-numbers", id: "unpinned", code });

describe("layoutOf", () => {
    it("reads a section whose layout never varies", () => {
        expect(layoutOf("monster_old", undefined)).toBe("cycles");
        expect(layoutOf("town_static", undefined)).toBe("bare");
        expect(layoutOf("monster_quadrant", undefined)).toBe("quadrant");
        expect(layoutOf("character_old", undefined)).toBe("characterOld");
    });

    /**
     * The declared split is of the BANDS, not of the picture. Reading it as quarters composed four separate
     * animations into one, and the two readings are indistinguishable by name - both produce `G11`..`G14`.
     * What separates them is geometry: quarters of one picture share a frame geometry, as the tiled
     * families' parts do, and these files do not.
     */
    it("splits the one section that takes two layouts on the field that declares it", () => {
        expect(layoutOf("monster", true)).toBe("splitCycles");
        expect(layoutOf("monster", false)).toBe("cycles");
    });

    it("treats an undeclared split as the unsplit layout rather than assuming the other", () => {
        expect(layoutOf("monster", undefined)).toBe("cycles");
    });

    /**
     * The archive still decides between this section's two layouts - but NOT the quadrant one, which its
     * own definition never names. Two sets share the `MTAN` prefix, a demon of this section and a tiled
     * one, and probing quadrants put the tiled set's thirty-six bands in the demon's stance picker: the
     * same neighbour trap the wide-band family below already documents.
     */
    it("lets the archive decide for the section that mixes, without probing a neighbour's quadrants", () => {
        expect(layoutOf("monster_icewind", undefined)).toBe("actionsOrCycles");
    });

    /**
     * The wide-band family's own definition names one cycle per file plus an eastern twin, and nothing in
     * either install contradicts it. The quadrant files its prefix also resolves belong to the quadrant
     * animations that share the prefix - see `layoutOf`.
     */
    it("reads the wide-band family as one cycle per file, not as whatever its prefix resolves", () => {
        expect(layoutOf("monster_large16", undefined)).toBe("cycles");
    });

    /**
     * The install's quadrant count looks like it should settle this outright - and does not need to.
     * See `layoutOf`: the archive already agrees with it on every prefix in either install.
     */
    it("leaves a mixed section to the archive even where the install declares a quadrant count", () => {
        expect(layoutOf("multi_new", true)).toBe("mixed");
    });

    it("gives no layout to a section nothing here covers", () => {
        expect(layoutOf("monster_wyvern", undefined)).toBeUndefined();
        expect(layoutOf(undefined, undefined)).toBeUndefined();
    });
});

describe("layerPrefixes", () => {
    /**
     * The spell-layered family names its overlay by the FIRST character of the declared code; the rest of
     * the code says which weapons it covers, which is the creature's business rather than the animation's.
     */
    it("appends a declared weapon overlay's letter to the resref", () => {
        expect(layerPrefixes("monster_layered_spell", "MOGM", ["S"])).toEqual(["MOGMS"]);
        expect(layerPrefixes("monster_layered_spell", "MSIR", ["B"])).toEqual(["MSIRB"]);
    });

    it("gives a spell-layered animation that declares no overlay no second layer", () => {
        expect(layerPrefixes("monster_layered_spell", "MDKN", [])).toEqual([]);
    });

    /** The burrowing family's second set is not declared anywhere - the engine names it by the family. */
    it("gives the burrowing family its undeclared second set", () => {
        expect(layerPrefixes("monster_ankheg", "MAKH", [])).toEqual(["MAKHD"]);
    });

    it("gives a family that draws from one set of files no second layer", () => {
        expect(layerPrefixes("monster_layered", "MFLE", ["S"])).toEqual([]);
        expect(layerPrefixes(undefined, "MFLE", [])).toEqual([]);
        expect(layerPrefixes("monster_ankheg", undefined, [])).toEqual([]);
    });
});

describe("schemeMembers", () => {
    const has = (...names: string[]) => {
        const set = new Set(names);
        return (resref: string): boolean => set.has(resref);
    };

    /**
     * Each band file is its own member, drawing itself. The bug this pins composed the four band files into
     * one member per cycle, so four separate animations were merged into a single picture and the bands that
     * were only reachable through them disappeared.
     */
    it("gives a declared band split one member per file rather than one composed of them", () => {
        const members = schemeMembers("splitCycles", "MEAS", has("MEASG1", "MEASG11", "MEASG12"), undefined);
        expect(members.map((member) => member.resref)).toEqual(["MEASG1", "MEASG11", "MEASG12"]);
        expect(members.map((member) => member.parts)).toEqual([["MEASG1"], ["MEASG11"], ["MEASG12"]]);
    });

    /**
     * A split file carries the whole cycle table and is authoritative for ONE band, so it has to say which.
     * Without that every file offers each band it happens to carry and the picker shows one clip several
     * times - a set of eleven files came back as twenty-four rows over twelve distinct stances.
     *
     * The positions are the reference's own split map, confirmed per file on two sets by measuring which
     * band holds art larger than a placeholder. The first group puts its bare file at band 1 and its `1`
     * digit at band 0; the attack group puts its bare file at band 0. That asymmetry is the reference's,
     * not a rule derived here.
     */
    it("names each band file of a declared split for the one band it owns", () => {
        const members = schemeMembers(
            "splitCycles",
            "MEAS",
            has("MEASG1", "MEASG11", "MEASG13", "MEASG2", "MEASG21", "MEASG25"),
            undefined,
        );
        expect(members.map((member) => [member.resref, member.ownBand])).toEqual([
            ["MEASG1", 1],
            ["MEASG11", 0],
            ["MEASG13", 3],
            ["MEASG2", 0],
            ["MEASG21", 1],
            ["MEASG25", 5],
        ]);
    });

    /**
     * A layer is a member of its own rather than a part of the base one: measured on a classic archive, an
     * overlay file's palette differs from its base's, and the composer merges indexed pixels on the
     * assumption that parts share one.
     *
     * The layer travels as a FIELD as well as in the label, because the band reader names its stances from
     * a block table and discards the label - and both runs then come back under the same eight names.
     */
    it("names a layer's members apart from the base ones", () => {
        const members = schemeMembers("cycles", "MOGMS", has("MOGMSG1", "MOGMSG1E"), "weapon overlay");
        expect(members).toEqual([
            {
                label: "G1 (weapon overlay)",
                name: "G1 (weapon overlay)",
                action: cycleAction("G1"),
                resref: "MOGMSG1",
                parts: ["MOGMSG1", "MOGMSG1E"],
                layer: "weapon overlay",
            },
        ]);
    });

    it("offers the resref itself where the layout carries no suffix", () => {
        expect(schemeMembers("bare", "SNOMC", has("SNOMC"))).toEqual([
            // No suffix means no action code: the empty one, which names the file back as the bare resref.
            { label: "SNOMC", name: "SNOMC", action: cycleAction(""), resref: "SNOMC", parts: ["SNOMC"] },
        ]);
    });

    it("offers only the cycles the install ships", () => {
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1"))).toEqual([
            { label: "G1", name: "G1", action: cycleAction("G1"), resref: "MOGHG1", parts: ["MOGHG1"] },
        ]);
    });

    // Every unmirrored scheme keeps its three eastern facings in a twin at the same cycle positions, so a
    // member listing only the base file draws whatever the base pads those slots with.
    it("draws a cycle's eastern twin as part of the same member", () => {
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1", "MOGHG1E"))).toEqual([
            { label: "G1", name: "G1", action: cycleAction("G1"), resref: "MOGHG1", parts: ["MOGHG1", "MOGHG1E"] },
        ]);
        expect(schemeMembers("actions", "METN", has("METNWK", "METNWKE"))[0]?.parts).toEqual(["METNWK", "METNWKE"]);
    });

    it("gathers a cycle's four quarters into ONE member", () => {
        // The quarters are pieces of a single sprite, so offering them separately would offer corners.
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG11", "MWYVG12", "MWYVG13", "MWYVG14"))).toEqual([
            {
                label: "G1",
                name: "G1",
                action: cycleAction("G1"),
                resref: "MWYVG11",
                parts: ["MWYVG11", "MWYVG12", "MWYVG13", "MWYVG14"],
            },
        ]);
    });

    it("puts every quarter's eastern twin after the quarters themselves", () => {
        // The split is of the picture, not of the facings, so each quarter has its own twin; the quarters
        // stay together ahead of them, since a member is identified by the first file it draws.
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG11", "MWYVG11E", "MWYVG12"))[0]?.parts).toEqual([
            "MWYVG11",
            "MWYVG12",
            "MWYVG11E",
        ]);
    });

    it("keeps a quadrant member the install has only some quarters of", () => {
        // Drawing three quarters beats dropping the animation from the list entirely.
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG11", "MWYVG13"))).toEqual([
            { label: "G1", name: "G1", action: cycleAction("G1"), resref: "MWYVG11", parts: ["MWYVG11", "MWYVG13"] },
        ]);
    });

    it("identifies a quadrant member by the first quarter the install actually has", () => {
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG13"))[0]?.resref).toBe("MWYVG13");
    });

    it("offers the action codes the animation carries and no others", () => {
        expect(schemeMembers("actions", "METN", has("METNWK", "METNDE"))).toEqual([
            {
                label: "DE - die",
                name: "Die",
                action: { scheme: "action-codes", id: "die", code: "DE" },
                resref: "METNDE",
                parts: ["METNDE"],
            },
            {
                label: "WK - walk",
                name: "Walk",
                action: { scheme: "action-codes", id: "walk", code: "WK" },
                resref: "METNWK",
                parts: ["METNWK"],
            },
        ]);
    });

    it("offers no members for the two layouts armour level resolves", () => {
        // A character set's files are named per armour level, which is a dimension this resolver does not
        // take - the character scheme answers for both, including the paired layout's mirrored twin.
        expect(schemeMembers("character", "CDMB", has("CDMB1G1"))).toEqual([]);
        expect(schemeMembers("characterOld", "CDMB", has("CDMB1G1", "CDMB1G1E"))).toEqual([]);
    });

    it("takes whichever family the files answer for, where the section mixes two", () => {
        expect(schemeMembers("mixed", "MTAN", has("MTANG11", "MTANG12"))).toEqual([
            { label: "G1", name: "G1", action: cycleAction("G1"), resref: "MTANG11", parts: ["MTANG11", "MTANG12"] },
        ]);
        expect(schemeMembers("mixed", "METN", has("METNWK"))).toEqual([
            {
                label: "WK - walk",
                name: "Walk",
                action: { scheme: "action-codes", id: "walk", code: "WK" },
                resref: "METNWK",
                parts: ["METNWK"],
            },
        ]);
    });

    it("resolves nothing for an animation with no declared prefix", () => {
        expect(schemeMembers("cycles", undefined, has("anything"))).toEqual([]);
    });

    it("leaves the armour-dimensioned layouts to the scheme that owns them", () => {
        expect(schemeMembers("character", "CHMB", has("CHMB1G1"))).toEqual([]);
    });
});

describe("action code names", () => {
    const has = (...names: string[]) => {
        const set = new Set(names);
        return (resref: string): boolean => set.has(resref);
    };

    it("names the stance a two-character code stands for", () => {
        expect(schemeMembers("actions", "METN", has("METNWK"))).toEqual([
            {
                label: "WK - walk",
                name: "Walk",
                action: { scheme: "action-codes", id: "walk", code: "WK" },
                resref: "METNWK",
                parts: ["METNWK"],
            },
        ]);
        expect(schemeMembers("actions", "METN", has("METNDE", "METNGH"))).toEqual([
            {
                label: "DE - die",
                name: "Die",
                action: { scheme: "action-codes", id: "die", code: "DE" },
                resref: "METNDE",
                parts: ["METNDE"],
            },
            {
                label: "GH - get hit",
                name: "Get hit",
                action: { scheme: "action-codes", id: "get-hit", code: "GH" },
                resref: "METNGH",
                parts: ["METNGH"],
            },
        ]);
    });

    it("leaves a code the sources disagree on as the bare code", () => {
        // CA/SP: the engine's playback order and IESDP's block names invert each other, so naming
        // either one would ship a coin flip as a fact.
        expect(schemeMembers("actions", "METN", has("METNCA"))).toEqual([
            // The label stays bare while the vocabulary still calls it a spell: which HALF of a cast it is
            // is the disputed part, not whether it is one.
            {
                label: "CA",
                name: "CA",
                action: { scheme: "action-codes", id: "spell", code: "CA" },
                resref: "METNCA",
                parts: ["METNCA"],
            },
        ]);
        expect(schemeMembers("actions", "METN", has("METNA3"))).toEqual([
            {
                label: "A3",
                name: "A3",
                action: { scheme: "action-codes", id: "attack", code: "A3" },
                resref: "METNA3",
                parts: ["METNA3"],
            },
        ]);
    });

    it("keeps the cycle and quadrant layouts on their file suffixes", () => {
        // G-files pack several stances, so the FILE has no single stance name - the bands do.
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1"))).toEqual([
            { label: "G1", name: "G1", action: cycleAction("G1"), resref: "MOGHG1", parts: ["MOGHG1"] },
        ]);
    });
});

describe.skipIf(GAME === undefined)("over a real install", () => {
    /**
     * The promise the gallery makes: if the install ships art for an animation, the list can open it.
     *
     * Asked of the ARCHIVE rather than of a section list, because the two ways a row draws nothing are not
     * distinguishable from the declaration alone - a game's tables name animations belonging to other games
     * in the family, and those legitimately have no files. Anything with files and no member is our gap.
     */
    it("resolves a member for every animation the install actually ships files for", () => {
        const game = openGame(GAME!);
        expect(game, `no game at ${GAME}`).toBeDefined();

        const bams: string[] = [];
        for (const ref of game!.list()) {
            if (ref.ext?.toLowerCase() === "bam") bams.push(ref.resref.toUpperCase());
        }
        const sets = buildAnimationIndex(game!, tableForFlavour(game!.identity.flavour));
        const exists = (resref: string): boolean => game!.canRead(resref, "bam");

        const undrawn: string[] = [];
        let shipping = 0;
        for (const set of sets) {
            const prefix = [...set.prefixByArmour.values()][0]?.toUpperCase();
            if (prefix === undefined || !bams.some((name) => name.startsWith(prefix))) continue;
            shipping += 1;
            if (setTile(set, exists).resref === undefined) {
                undrawn.push(`0x${set.id.toString(16)} ${set.name || set.code} (${prefix})`);
            }
        }
        process.stdout.write(`  ${shipping - undrawn.length}/${shipping} animations with art resolve a file\n`);
        expect(shipping, "no animation in this install ships art, so nothing was exercised").toBeGreaterThan(0);
        expect(undrawn).toEqual([]);
    });

    /**
     * A split set offers each of its clips once.
     *
     * Every band file of this family carries its neighbours' bands as well, at the same cycles and frame
     * counts, so a list keyed on "this file draws that band" shows one clip once per file carrying a copy -
     * and a reader choosing between those rows is choosing at random. The band map is what settles which
     * file each band belongs to; without it one set came back as twenty-four rows over twelve stances.
     */
    it("offers each stance of a split set once rather than once per file carrying it", (ctx) => {
        const game = openGame(GAME!);
        expect(game, `no game at ${GAME}`).toBeDefined();
        const io = stanceIo(game!);

        const repeated: string[] = [];
        let split = 0;
        let rows = 0;
        for (const set of buildAnimationIndex(game!, tableForFlavour(game!.identity.flavour))) {
            if (set.layout !== "splitCycles") continue;
            split += 1;
            for (const armour of drawnArmourLevels(set, io.exists)) {
                const seen = new Map<string, number>();
                for (const stance of setStances(set, armour, io)) {
                    // The attack group's last two files, whose mapped bands are past the end of a set whose
                    // files carry fewer. A file that does not draw the band it is named for falls back to
                    // offering every band it does draw, deliberately - it holds a clip of its own, so the
                    // surplus row is a better failure than dropping the member (see `stancesOfMembers`).
                    // Every other file of the split is in scope, which is what this guards.
                    if (stance.resref.endsWith("G25") || stance.resref.endsWith("G26")) continue;
                    rows += 1;
                    seen.set(stance.label, (seen.get(stance.label) ?? 0) + 1);
                }
                for (const [label, count] of seen) {
                    if (count > 1) repeated.push(`${set.name || set.code} armour ${armour}: ${label} x${count}`);
                }
            }
        }
        process.stdout.write(`  ${split} split sets checked, ${rows} stance rows\n`);
        // Only an install that declares its own animations reaches this layout - the split is a declared
        // field, and the vendored table for the classic games carries none. Skipped rather than failed
        // there, since an absent class is the install's shape and not a regression; the count above is
        // what says which of the two a green run was.
        if (split === 0) ctx.skip("this install declares no split set");
        expect(repeated).toEqual([]);
    });

    /**
     * The claim these layouts make is that they name files the install has. A layout that named nothing would
     * show as an animation with no members - indistinguishable, in the panel, from one the install omits.
     */
    it("resolves at least one member for most animations it claims a layout for", () => {
        const game = openGame(GAME!);
        expect(game, `no game at ${GAME}`).toBeDefined();
        const exists = (resref: string): boolean => game!.canRead(resref, "bam");

        let claimed = 0;
        let resolved = 0;
        const byLayout = new Map<string, { claimed: number; resolved: number }>();
        for (const ref of game!.list()) {
            if (ref.ext?.toLowerCase() !== "ini" || !/^[0-9A-Fa-f]{4}$/.test(ref.resref)) continue;
            const ini = parseAnimationIni(game!.read(ref.resref, "ini"));
            const layout = layoutOf(ini.section, ini.splitBams);
            if (layout === undefined || layout === "character" || layout === "characterOld") continue;
            // An animation the install declares but ships no art for is not this rule's failure.
            if (ini.resref === undefined) continue;
            const members = schemeMembers(layout, ini.resref, exists);
            const tally = byLayout.get(layout) ?? { claimed: 0, resolved: 0 };
            tally.claimed += 1;
            claimed += 1;
            if (members.length > 0) {
                tally.resolved += 1;
                resolved += 1;
            }
            byLayout.set(layout, tally);
        }
        for (const [layout, tally] of byLayout) {
            process.stdout.write(`  ${layout}: ${tally.resolved}/${tally.claimed} resolve\n`);
        }
        // A classic install ships no animation INIs at all - its declarations come from the vendored table -
        // so zero here is a property of the game, not a failure. The sibling above covers those installs.
        if (claimed === 0) {
            process.stdout.write("  (this install declares no animation INIs)\n");
            return;
        }
        expect(resolved).toBeGreaterThan(0);
    });
});
