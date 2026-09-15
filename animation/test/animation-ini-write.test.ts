/**
 * Writing an animation's own declaration.
 *
 * A converted set used to land as art with no declaration at all: the notes named the two IDS rows and
 * never mentioned the section, so nothing said what family the engine should read the files as. The
 * oracle here is this project's own parser - what the writer emits has to come back as what it was given,
 * because that parser is what every consumer reads a shipped install through.
 */
import { describe, expect, it } from "vitest";
import { parseAnimationIni } from "../src/animation-ini";
import { writeAnimationIni } from "../src/animation-ini-write";

function roundTrip(input: Parameters<typeof writeAnimationIni>[0]) {
    return parseAnimationIni(new TextEncoder().encode(writeAnimationIni(input)));
}

describe("writeAnimationIni", () => {
    it("declares the section, the prefix and the type the reader gave it", () => {
        const read = roundTrip({ section: "monster", animationType: 0x4000, resref: "NEWB" });

        expect(read.section).toBe("monster");
        expect(read.animationType).toBe(0x4000);
        expect(read.resref).toBe("NEWB");
    });

    /**
     * The type is hex and not always digits - a large minority of an install's animations declare `a000`
     * through `e000`, which decimal parsing reads as NaN. Written the way it is read.
     */
    it("writes the animation type in hex", () => {
        expect(roundTrip({ section: "monster", animationType: 0xa000, resref: "NEWB" }).animationType).toBe(0xa000);
    });

    /** A character set's armour levels are part of its declaration, not of its file names alone. */
    it("declares a character set's armour coding", () => {
        const read = roundTrip({
            section: "character",
            animationType: 0x6000,
            resref: "NEWB",
            armorMax: 4,
            armorBase: "B",
            armorSpecific: "C",
        });

        expect(read.armorMax).toBe(4);
        expect(read.armorBase).toBe("B");
        expect(read.armorSpecific).toBe("C");
    });

    /**
     * The flag the engine reads to decide whether to look for `*E.BAM` at all. It never probes for the
     * file, so a set written with its east stored and this flag unset draws mirrored west and the stored
     * art is never addressed - which is why it is written from the same choice that stored the east.
     */
    it("declares whether the eastern facings are stored or mirrored", () => {
        expect(
            roundTrip({ section: "monster", animationType: 0x4000, resref: "NEWB", splitBams: true }).splitBams,
        ).toBe(true);
        expect(
            roundTrip({ section: "monster", animationType: 0x4000, resref: "NEWB", splitBams: false }).splitBams,
        ).toBe(false);
    });

    /** Absent, not defaulted: a key nobody asked for is one the install never declared. */
    it("leaves out every key the caller named no value for", () => {
        const read = roundTrip({ section: "monster", animationType: 0x4000, resref: "NEWB" });

        expect(read.armorMax).toBeUndefined();
        expect(read.splitBams).toBeUndefined();
        expect(read.resrefPaperdoll).toBeUndefined();
        expect(read.falseColor).toBeUndefined();
    });

    /** `[general]` carries the type; the drawing keys belong to the section's own block. */
    it("puts the type in the general block and the drawing keys in the section's", () => {
        const text = writeAnimationIni({ section: "monster", animationType: 0x4000, resref: "NEWB" });

        expect(text.indexOf("[general]")).toBeLessThan(text.indexOf("animation_type"));
        expect(text.indexOf("[monster]")).toBeLessThan(text.indexOf("resref"));
        expect(text.indexOf("animation_type")).toBeLessThan(text.indexOf("[monster]"));
    });
});
