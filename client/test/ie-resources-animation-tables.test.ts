import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { buildAnimationIndex } from "../src/ie-resources/animation-index";
import { tableForFlavour } from "../src/ie-resources/animation-tables";
import { characterDrawsBody } from "../src/ie-resources/animation-schemes/character";

/**
 * Point `BGFORGE_IE_GAME` at a CLASSIC install this repo carries a table for and these run; anything else -
 * unset, or an Enhanced Edition, which declares its own animations and never asks a table - skips.
 */
const GAME = process.env.BGFORGE_IE_GAME;
const game = GAME === undefined ? undefined : openGame(GAME);
const table = game === undefined ? undefined : tableForFlavour(game.identity.flavour);

describe.skipIf(table === undefined)("a vendored table against the install it is for", () => {
    /**
     * The claim a table makes is that the files it names are there. Nothing else checks it: a wrong prefix
     * produces a picker with no actions, not an error, and the panel renders that as an animation the install
     * merely happens not to ship.
     */
    it("names files the install actually has, for every character row", () => {
        const exists = (resref: string): boolean => game!.canRead(resref, "bam");
        const sets = buildAnimationIndex(game!, table);
        const character = sets.filter((set) => set.scheme.kind === "character");
        const dead = character.filter((set) => !characterDrawsBody(set, exists));

        expect(
            character.length,
            `${GAME} lists no character animations, so it cannot show a wrong row`,
        ).toBeGreaterThan(0);
        expect(dead.map((set) => `0x${set.id.toString(16).padStart(4, "0")}`)).toEqual([]);
    });

    it("leaves the ids it does not cover listed rather than dropping or guessing them", () => {
        const sets = buildAnimationIndex(game!, table);
        const uncovered = sets.filter((set) => set.scheme.kind !== "character" && set.prefixByArmour.size === 0);

        // Both halves are information, not thresholds: what the table reaches, and what it leaves for later.
        process.stdout.write(`${GAME}: ${sets.length} listed, ${sets.length - uncovered.length} with prefixes\n`);
        expect(sets.length).toBeGreaterThan(uncovered.length);
    });
});
