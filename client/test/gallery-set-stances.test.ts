import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { type AnimationSet, buildAnimationIndex } from "../src/ie-resources/animation-index";
import { tableForFlavour } from "../src/ie-resources/animation-tables";
import { firstArmour, setStances, type StanceIo } from "../src/gallery/set-stances";

const GAME = process.env.BGFORGE_IE_GAME;

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
