import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { buildAnimationIndex } from "../src/ie-resources/animation-index";
import { tableForFlavour } from "../src/ie-resources/animation-tables";
import { characterDrawsBody } from "../src/ie-resources/animation-schemes/character";
import { setTile } from "../src/gallery/set-tiles";

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

    it("leaves the ids it does not cover listed rather than dropping or guessing them", () => {
        const sets = buildAnimationIndex(game!, table);
        const uncovered = sets.filter((set) => set.scheme.kind !== "character" && set.prefixByArmour.size === 0);

        // Both halves are information, not thresholds: what the table reaches, and what it leaves for later.
        process.stdout.write(`${GAME}: ${sets.length} listed, ${sets.length - uncovered.length} with prefixes\n`);
        expect(sets.length).toBeGreaterThan(uncovered.length);
    });
});
