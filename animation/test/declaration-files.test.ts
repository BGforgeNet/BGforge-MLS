/**
 * The files a converted set needs beside its art.
 *
 * Everything these carry was already in the notes as instructions, so the test that matters is that the
 * generated file says the same thing the instructions did - and, for the INI, that this project's own
 * parser reads back what was written.
 */
import { describe, expect, it } from "vitest";
import { declaredFamily, parseAnimationIni } from "../src/animation-ini";
import { declarationFiles, type DeclarationInput } from "../src/convert/declaration-files";
import { FALLOUT_FRM, IE_16_POINT_FULL, IE_8_POINT_MIRRORED, IE_8_POINT_PAIRED } from "../src/convert/target";

function input(over: Partial<DeclarationInput> = {}): DeclarationInput {
    return {
        target: IE_8_POINT_MIRRORED,
        targetId: 0x6006,
        prefix: "NEWB",
        section: "monster",
        naming: "character",
        ...over,
    };
}

/** The declared file scheme, read back through this project's own parser. */
function splitBamsOf(from: DeclarationInput): boolean | undefined {
    const text = fileNamed(declarationFiles(from), "6006.ini");
    return parseAnimationIni(new TextEncoder().encode(text)).splitBams;
}

function fileNamed(files: ReturnType<typeof declarationFiles>, name: string): string {
    const found = files.find((file) => file.name === name);
    if (found === undefined) throw new Error(`no ${name}, only: ${files.map((f) => f.name).join(", ")}`);
    return found.text;
}

describe("declarationFiles for an Infinity Engine target", () => {
    /** The declaration is read as the id in hex, so the name is what makes the file findable at all. */
    it("names the declaration after the id in hex, and writes nothing else", () => {
        expect(declarationFiles(input()).map((file) => file.name)).toEqual(["6006.ini"]);
    });

    it("writes a declaration this project's own parser reads back", () => {
        const read = parseAnimationIni(new TextEncoder().encode(fileNamed(declarationFiles(input()), "6006.ini")));

        expect(read.section).toBe("monster");
        expect(read.resref).toBe("NEWB");
    });

    /**
     * The burrowing family is the only one that declares whether its east is computed, and it is the only
     * one this writes the field for: elsewhere the type fixes the answer and a declaration of it is read
     * by nothing. Written from the target, since that is what decided whether a companion was produced.
     */
    it("declares the computed east for the one family that reads such a declaration", () => {
        const burrowing = fileNamed(declarationFiles(input({ section: "monster_ankheg" })), "6006.ini");
        const other = fileNamed(declarationFiles(input({ section: "monster" })), "6006.ini");

        expect(burrowing).toContain("mirror=");
        expect(other).not.toContain("mirror=");
    });

    /**
     * The flag names the FILE SCHEME, not the eastern facings. The published documentation states it
     * identically for every type that carries one: 0 packs the animation into `G1` and `G2`, 1 spreads it
     * over subfiles. One reference reads it to choose between exactly those two suffix maps and the other
     * never reads it at all, keying the file names off the animation type instead - which is also what
     * decides whether an eastern companion exists, so no flag can carry that choice.
     */
    it("declares the file scheme the naming wrote", () => {
        expect(splitBamsOf(input({ naming: "cycle-numbers" }))).toBe(false);
        expect(splitBamsOf(input({ naming: "character" }))).toBe(true);
        expect(splitBamsOf(input({ naming: "action-codes" }))).toBe(true);
    });

    /**
     * And does not move with the direction profile, which was the bug: read off the dialog's "store the
     * east" axis, five of the eight reachable pairings declared a scheme the conversion had not written,
     * sending the engine after filenames nothing made.
     */
    it("keeps the file-scheme flag off the direction profile", () => {
        for (const target of [IE_8_POINT_MIRRORED, IE_8_POINT_PAIRED, IE_16_POINT_FULL]) {
            expect(splitBamsOf(input({ naming: "character", target })), target.label).toBe(true);
            expect(splitBamsOf(input({ naming: "cycle-numbers", target })), target.label).toBe(false);
        }
    });

    /**
     * `monster_layered_spell` is this project's name for a family, not a header an install writes: an
     * install declares `[monster_layered]` and tells the two apart by the type. A file naming the
     * synthesised header declares a family nothing recognises, so what is written has to be what an
     * install would have written - which the round trip through `declaredFamily` is the check on.
     */
    it("writes a family in the install's own vocabulary, which reads back as the same family", () => {
        const text = fileNamed(declarationFiles(input({ section: "monster_layered_spell" })), "6006.ini");
        const read = parseAnimationIni(new TextEncoder().encode(text));

        expect(read.section).toBe("monster_layered");
        expect(declaredFamily(read)).toBe("monster_layered_spell");
    });

    /** A type is stated only where the header alone cannot name the family - never invented for the rest. */
    it("states no type for a family its header already names", () => {
        const text = fileNamed(declarationFiles(input()), "6006.ini");

        expect(parseAnimationIni(new TextEncoder().encode(text)).animationType).toBeUndefined();
    });

    /**
     * A set whose install declares no family leaves the reader nothing to seed the section from, and an
     * INI headed by an empty `[]` names no family at all - a file that parses as nothing rather than as
     * the declaration it looks like. Better no file, which the notes beside it already account for.
     */
    it("writes no declaration when no family is named", () => {
        expect(declarationFiles(input({ section: "" }))).toEqual([]);
    });

    it("carries the armour levels where the naming has them", () => {
        const text = fileNamed(declarationFiles(input({ armourLevels: 4 })), "6006.ini");

        expect(parseAnimationIni(new TextEncoder().encode(text)).armorMax).toBe(4);
    });
});

describe("declarationFiles for a Fallout target", () => {
    /** Fallout declares an animation by its position in an art list, not by an id in a table. */
    it("writes the art-list rows and no Infinity Engine declaration", () => {
        const files = declarationFiles(input({ target: FALLOUT_FRM }));

        expect(files.map((file) => file.name)).toEqual(["NEWB-critters.txt"]);
        expect(files[0]?.text).toContain("NEWB");
        expect(files[0]?.text).toContain("CRITTERS.LST");
    });
});
