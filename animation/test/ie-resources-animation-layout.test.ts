import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { layoutOf } from "../src/animation-schemes/layout";
import { schemeMembers } from "../src/animation-schemes/members";
import { parseAnimationIni } from "../src/animation-ini";
import { buildAnimationIndex } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { setTile } from "../src/set-tiles";

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

    it("splits the one section that takes two layouts on the field that declares it", () => {
        expect(layoutOf("monster", true)).toBe("quadrant");
        expect(layoutOf("monster", false)).toBe("cycles");
    });

    it("treats an undeclared split as the unsplit layout rather than assuming the other", () => {
        expect(layoutOf("monster", undefined)).toBe("cycles");
    });

    it("lets the archive decide for the sections that mix layouts with nothing declaring which", () => {
        expect(layoutOf("monster_icewind", undefined)).toBe("mixed");
        expect(layoutOf("monster_large16", undefined)).toBe("mixed");
    });

    it("gives no layout to a section nothing here covers", () => {
        expect(layoutOf("monster_wyvern", undefined)).toBeUndefined();
        expect(layoutOf(undefined, undefined)).toBeUndefined();
    });
});

describe("schemeMembers", () => {
    const has = (...names: string[]) => {
        const set = new Set(names);
        return (resref: string): boolean => set.has(resref);
    };

    it("offers the resref itself where the layout carries no suffix", () => {
        expect(schemeMembers("bare", "SNOMC", has("SNOMC"))).toEqual([
            // No suffix means no action code: the empty one, which names the file back as the bare resref.
            { label: "SNOMC", action: cycleAction(""), resref: "SNOMC", parts: ["SNOMC"] },
        ]);
    });

    it("offers only the cycles the install ships", () => {
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1"))).toEqual([
            { label: "G1", action: cycleAction("G1"), resref: "MOGHG1", parts: ["MOGHG1"] },
        ]);
    });

    // Every unmirrored scheme keeps its three eastern facings in a twin at the same cycle positions, so a
    // member listing only the base file draws whatever the base pads those slots with.
    it("draws a cycle's eastern twin as part of the same member", () => {
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1", "MOGHG1E"))).toEqual([
            { label: "G1", action: cycleAction("G1"), resref: "MOGHG1", parts: ["MOGHG1", "MOGHG1E"] },
        ]);
        expect(schemeMembers("actions", "METN", has("METNWK", "METNWKE"))[0]?.parts).toEqual(["METNWK", "METNWKE"]);
    });

    it("gathers a cycle's four quarters into ONE member", () => {
        // The quarters are pieces of a single sprite, so offering them separately would offer corners.
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG11", "MWYVG12", "MWYVG13", "MWYVG14"))).toEqual([
            {
                label: "G1",
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
            { label: "G1", action: cycleAction("G1"), resref: "MWYVG11", parts: ["MWYVG11", "MWYVG13"] },
        ]);
    });

    it("identifies a quadrant member by the first quarter the install actually has", () => {
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG13"))[0]?.resref).toBe("MWYVG13");
    });

    it("offers the action codes the animation carries and no others", () => {
        expect(schemeMembers("actions", "METN", has("METNWK", "METNDE"))).toEqual([
            {
                label: "DE - die",
                action: { scheme: "action-codes", id: "die", code: "DE" },
                resref: "METNDE",
                parts: ["METNDE"],
            },
            {
                label: "WK - walk",
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
            { label: "G1", action: cycleAction("G1"), resref: "MTANG11", parts: ["MTANG11", "MTANG12"] },
        ]);
        expect(schemeMembers("mixed", "METN", has("METNWK"))).toEqual([
            {
                label: "WK - walk",
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
                action: { scheme: "action-codes", id: "walk", code: "WK" },
                resref: "METNWK",
                parts: ["METNWK"],
            },
        ]);
        expect(schemeMembers("actions", "METN", has("METNDE", "METNGH"))).toEqual([
            {
                label: "DE - die",
                action: { scheme: "action-codes", id: "die", code: "DE" },
                resref: "METNDE",
                parts: ["METNDE"],
            },
            {
                label: "GH - get hit",
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
                action: { scheme: "action-codes", id: "spell", code: "CA" },
                resref: "METNCA",
                parts: ["METNCA"],
            },
        ]);
        expect(schemeMembers("actions", "METN", has("METNA3"))).toEqual([
            {
                label: "A3",
                action: { scheme: "action-codes", id: "attack", code: "A3" },
                resref: "METNA3",
                parts: ["METNA3"],
            },
        ]);
    });

    it("keeps the cycle and quadrant layouts on their file suffixes", () => {
        // G-files pack several stances, so the FILE has no single stance name - the bands do.
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1"))).toEqual([
            { label: "G1", action: cycleAction("G1"), resref: "MOGHG1", parts: ["MOGHG1"] },
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
