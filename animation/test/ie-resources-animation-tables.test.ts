import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { buildAnimationIndex } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { characterDrawsBody } from "../src/animation-schemes/character";
import { drawnArmourLevels } from "../src/set-stances";
import { setTile } from "../src/set-tiles";

/**
 * Point `BGFORGE_IE_GAME` at any install of a family this repo carries a table for and these run.
 *
 * An Enhanced Edition reaches a table too, which it did not used to: it declares every AVATAR in its own
 * INIs, but not the effect animations below 0x1000, so those rows answer there as well.
 */
const GAME = process.env.BGFORGE_IE_GAME;
const game = GAME === undefined ? undefined : openGame(GAME);
const table = game === undefined ? undefined : tableForFlavour(game.identity.flavour);

/** The INI an animation declares itself in is named after its id in hex, four digits, uppercase. */
function declaresOwn(id: number): boolean {
    return game!.canRead(id.toString(16).toUpperCase().padStart(4, "0"), "ini");
}

describe.skipIf(table === undefined)("a vendored table against the install it is for", () => {
    /**
     * The claim a table makes is that the files it names are there. Nothing else checks it: a wrong prefix
     * produces a picker with no actions, not an error, and the panel renders that as an animation the install
     * merely happens not to ship.
     *
     * Scoped to the rows the TABLE supplies. An install that declares an animation itself and then ships no
     * art for it is making its own claim, not ours - one Enhanced Edition row does exactly that - and holding
     * the table to it would fail this on a defect nothing here can fix.
     */
    it("names files the install actually has, for every character row it supplies", () => {
        const exists = (resref: string): boolean => game!.canRead(resref, "bam");
        const sets = buildAnimationIndex(game!, table);
        const character = sets.filter((set) => set.scheme.kind === "character" && !declaresOwn(set.id));
        const dead = character.filter((set) => !characterDrawsBody(set, exists));

        // An Enhanced Edition declares every avatar itself and reaches this table only for the effect rows
        // below, so nothing here is its to answer for - a property of the install, not a failure.
        if (character.length === 0) {
            process.stdout.write("  (this install declares every avatar itself)\n");
            return;
        }
        expect(dead.map((set) => `0x${set.id.toString(16).padStart(4, "0")}`)).toEqual([]);
    });

    /**
     * The effect rows carry the same claim, and they are the ones an install never corrects: no game in the
     * family declares one, so a wrong resref here is wrong everywhere with nothing to override it.
     */
    it("draws every effect animation it covers", () => {
        const exists = (resref: string): boolean => game!.canRead(resref, "bam");
        const sets = buildAnimationIndex(game!, table).filter((set) => set.id < 0x1000 && table!.has(set.id));
        const dead = sets.filter((set) => setTile(set, exists).resref === undefined);

        expect(sets.length, `${GAME} lists no effect animation, so nothing was exercised`).toBeGreaterThan(0);
        process.stdout.write(`  ${sets.length - dead.length}/${sets.length} effect animations draw\n`);
        expect(dead.map((set) => `0x${set.id.toString(16).padStart(4, "0")} ${set.name || set.code}`)).toEqual([]);
    });

    /**
     * A row naming SOME body is not a row naming every armour level's body: a level whose prefix the row
     * gets wrong silently drops that level from the picker, and the test above passes on the other three.
     *
     * The thief bodies are the case. A classic archive spreads them over three letters - the base body at
     * levels 1 and 3, the class letter at 2, and the plate letter at 4 - and the rows carried only the
     * first two, so every thief lost its plate level. Measured against the archive rather than assumed:
     * `C<race><gender>F4G1` is present for all twenty of them.
     */
    it("draws every armour level the archive holds a body for, on the rows that split across prefixes", () => {
        const exists = (resref: string): boolean => game!.canRead(resref, "bam");
        // The letters each family's levels are actually stored under, read off a classic archive: a thief
        // is base/class/base/plate, a monk is monk/base/base/chain. Named per family rather than derived,
        // because deriving them from the row under test is what let the gap through in the first place.
        const expected = new Map<RegExp, (set: { name: string }) => string[]>([
            [/^THIEF_/, () => ["", "", "", "F4"]],
            [/^MONK_/, () => ["M1", "B2", "B3", "C4"]],
        ]);
        const sets = buildAnimationIndex(game!, table).filter((set) => table!.has(set.id) && !declaresOwn(set.id));

        const missing: string[] = [];
        for (const set of sets) {
            const rule = [...expected.entries()].find(([pattern]) => pattern.test(set.name))?.[1];
            if (rule === undefined) continue;
            const body = [...set.prefixByArmour.values()][0]?.slice(0, 3) ?? "";
            const drawn = new Set(drawnArmourLevels(set, exists));
            for (const [index, suffix] of rule(set).entries()) {
                // Only levels the archive HAS a body for; a level it lacks is the install's business.
                if (suffix === "" || !exists(`${body}${suffix}G1`)) continue;
                if (!drawn.has(index + 1)) missing.push(`${set.name} L${index + 1}: ${body}${suffix}G1`);
            }
        }

        expect(sets.length, `${GAME} supplies no rows here, so nothing was exercised`).toBeGreaterThan(0);
        expect(missing).toEqual([]);
    });

    it("leaves the ids it does not cover listed rather than dropping or guessing them", () => {
        const sets = buildAnimationIndex(game!, table);
        const uncovered = sets.filter((set) => set.scheme.kind !== "character" && set.prefixByArmour.size === 0);

        // Both halves are information, not thresholds: what the table reaches, and what it leaves for later.
        process.stdout.write(`${GAME}: ${sets.length} listed, ${sets.length - uncovered.length} with prefixes\n`);
        expect(sets.length).toBeGreaterThan(uncovered.length);
    });
});
