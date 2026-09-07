import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { declaredFamily, parseAnimationIni } from "../src/animation-ini";
import { miniGame } from "./ie-game-fixtures";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * An installed Enhanced Edition game, whose animations ship their own INIs.
 *
 * Unset means skip: game data is not redistributable, so there is nothing to point this at in CI. Point it
 * at a local install to run the suite. A CLASSIC install is the wrong target and would report a false
 * failure - it ships no animation INIs at all, which is why the vendored table exists.
 */
const EE_GAME = process.env.BGFORGE_IE_GAME;

describe("parseAnimationIni", () => {
    it("reads the drawing declaration, which need not match the animation's own code", () => {
        const ini = parseAnimationIni(miniGame().read("6004", "ini"));
        expect(ini.animationType).toBe(0x6000);
        expect(ini.section).toBe("character");
        expect(ini.resref).toBe("CDMB");
        expect(ini.resrefPaperdoll).toBe("CGMC");
        expect(ini.armorBase).toBe("B");
        expect(ini.armorSpecific).toBe("C");
        expect(ini.armorMax).toBe(4);
        expect(ini.splitBams).toBe(true);
        expect(ini.falseColor).toBe(true);
    });

    /**
     * The replacement palette a colour variant draws under, declared in `[general]` beside the family
     * number rather than in the drawing section. Without it the six colour dragons are the red one: they
     * share `MDR1`'s art and differ only here.
     *
     * The value is the resref itself, already composed - the magic golems' `MFIEG1B` is spelled out in the
     * install rather than derived, so nothing here has a special case for it.
     */
    it("reads the replacement palette from the general section", () => {
        const green = parseAnimationIni(
            encode("[general]\nanimation_type=1000\nnew_palette=MDR1_GR\n[multi_new]\nresref=MDR1\n"),
        );
        expect(green.newPalette).toBe("MDR1_GR");

        const golem = parseAnimationIni(
            encode("[general]\nanimation_type=7000\nnew_palette=MFIEG1B\n[monster]\nresref=MFIE\n"),
        );
        expect(golem.newPalette).toBe("MFIEG1B");

        const plain = parseAnimationIni(encode("[general]\nanimation_type=7000\n[monster]\nresref=MBER\n"));
        expect(plain.newPalette).toBeUndefined();
    });

    /**
     * `[monster_layered]` heads two different families, and only the spell-layered one ships the weapon
     * overlay files - so a reader that took the header alone would open half of one family's art.
     */
    it("separates the two families that share the layered section header", () => {
        const spell = encode("[general]\nanimation_type=2000\n[monster_layered]\nresref=MOGM\n");
        const plain = encode("[general]\nanimation_type=8000\n[monster_layered]\nresref=MFLE\n");

        expect(parseAnimationIni(spell).section).toBe("monster_layered");
        expect(declaredFamily(parseAnimationIni(spell))).toBe("monster_layered_spell");
        expect(declaredFamily(parseAnimationIni(plain))).toBe("monster_layered");
    });

    /** Type 1000 heads both tiled families, so there the header is the finer signal and has to win. */
    it("keeps the header where it says more than the declared type does", () => {
        const quadrant = encode("[general]\nanimation_type=1000\n[monster_quadrant]\nresref=MTAN\n");
        const tiled = encode("[general]\nanimation_type=1000\n[multi_new]\nresref=MDR1\n");

        expect(declaredFamily(parseAnimationIni(quadrant))).toBe("monster_quadrant");
        expect(declaredFamily(parseAnimationIni(tiled))).toBe("multi_new");
    });

    it("reads a hex animation_type that is not all digits", () => {
        const ini = parseAnimationIni(miniGame().read("A000", "ini"));
        expect(ini.animationType).toBe(0xa000);
        expect(ini.section).toBe("monster_large16");
        expect(ini.resref).toBe("MWYV");
    });

    it("leaves an undeclared field undefined rather than defaulting it", () => {
        const ini = parseAnimationIni(encode("[general]\nanimation_type=1000\n"));
        expect(ini.resref).toBeUndefined();
        expect(ini.armorMax).toBeUndefined();
        expect(ini.splitBams).toBeUndefined();
        expect(ini.section).toBeUndefined();
    });

    it("ignores comment lines and blank lines", () => {
        const ini = parseAnimationIni(encode("// MWYV wyvern\n\n[general]\nanimation_type=1000\n"));
        expect(ini.animationType).toBe(0x1000);
    });

    it("takes the drawing section as the first that is neither general nor sounds", () => {
        const ini = parseAnimationIni(
            encode("[general]\nanimation_type=1000\n\n[monster_quadrant]\nquadrants=4\n\n[sounds]\nattack=\n"),
        );
        expect(ini.section).toBe("monster_quadrant");
        expect(ini.quadrants).toBe(4);
    });
});

describe.skipIf(EE_GAME === undefined)("over a real install's animation INIs", () => {
    it("reads a declared type and a drawing section from every one", () => {
        const game = openGame(EE_GAME!);
        expect(game, `no game at ${EE_GAME}`).toBeDefined();
        // Animation INIs are named after the id in hex; an install may ship other .ini resources too.
        const inis = game!.list().filter((r) => r.ext?.toLowerCase() === "ini" && /^[0-9a-f]{1,4}$/i.test(r.resref));
        const undeclared: string[] = [];
        const sectionless: string[] = [];
        for (const ref of inis) {
            const ini = parseAnimationIni(game!.read(ref.resref, "ini"));
            if (ini.animationType === undefined) undeclared.push(ref.resref);
            if (ini.section === undefined) sectionless.push(ref.resref);
        }
        // The population is reported beside the verdict rather than asserted against a floor: the count is
        // the install's number, not ours, and a floor set at one install's ceiling reds on the next.
        expect({ inis: inis.length, undeclared, sectionless }).toEqual({
            inis: inis.length,
            undeclared: [],
            sectionless: [],
        });
    });
});
