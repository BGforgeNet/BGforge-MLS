import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { layoutOf } from "../src/ie-resources/animation-schemes/layout";
import { schemeMembers } from "../src/ie-resources/animation-schemes/members";
import { parseAnimationIni } from "../src/ie-resources/animation-ini";

const GAME = process.env.BGFORGE_IE_GAME;

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
        expect(schemeMembers("bare", "SNOMC", has("SNOMC"))).toEqual([{ label: "SNOMC", resref: "SNOMC" }]);
    });

    it("offers only the cycles the install ships", () => {
        expect(schemeMembers("cycles", "MOGH", has("MOGHG1"))).toEqual([{ label: "G1", resref: "MOGHG1" }]);
    });

    it("offers each cycle's quadrants separately", () => {
        expect(schemeMembers("quadrant", "MWYV", has("MWYVG11", "MWYVG13"))).toEqual([
            { label: "G11", resref: "MWYVG11" },
            { label: "G13", resref: "MWYVG13" },
        ]);
    });

    it("offers the action codes the animation carries and no others", () => {
        expect(schemeMembers("actions", "METN", has("METNWK", "METNDE"))).toEqual([
            { label: "DE", resref: "METNDE" },
            { label: "WK", resref: "METNWK" },
        ]);
    });

    it("takes whichever family the files answer for, where the section mixes two", () => {
        expect(schemeMembers("mixed", "MTAN", has("MTANG11"))).toEqual([{ label: "G11", resref: "MTANG11" }]);
        expect(schemeMembers("mixed", "METN", has("METNWK"))).toEqual([{ label: "WK", resref: "METNWK" }]);
    });

    it("resolves nothing for an animation with no declared prefix", () => {
        expect(schemeMembers("cycles", undefined, has("anything"))).toEqual([]);
    });

    it("leaves the armour-dimensioned layouts to the scheme that owns them", () => {
        expect(schemeMembers("character", "CHMB", has("CHMB1G1"))).toEqual([]);
    });
});

describe.skipIf(GAME === undefined)("over a real install", () => {
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
        expect(claimed, "no animation claimed a layout, so nothing was exercised").toBeGreaterThan(0);
        expect(resolved).toBeGreaterThan(0);
    });
});
