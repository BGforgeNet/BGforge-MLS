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
        ...over,
    };
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
     * The engine never looks to see whether an east file exists - it builds the name from this flag. A set
     * written with its east stored and this left off draws mirrored west and never addresses the art, so
     * the flag comes from the same choice that stored the east.
     */
    it("declares the east as stored exactly when the written files store it", () => {
        const stored = fileNamed(declarationFiles(input({ target: IE_8_POINT_PAIRED })), "6006.ini");
        const mirrored = fileNamed(declarationFiles(input()), "6006.ini");

        expect(parseAnimationIni(new TextEncoder().encode(stored)).splitBams).toBe(true);
        expect(parseAnimationIni(new TextEncoder().encode(mirrored)).splitBams).toBe(false);
    });

    /**
     * The sixteen-point target that stores every facing writes ONE wide-band file per member, not a pair -
     * the east is stored IN the base rather than beside it. Read off the dialog's "store the east" axis the
     * declaration would send the engine looking for a companion nothing wrote.
     */
    it("declares no companion for a target that stores the east in the base file", () => {
        const text = fileNamed(declarationFiles(input({ target: IE_16_POINT_FULL })), "6006.ini");

        expect(parseAnimationIni(new TextEncoder().encode(text)).splitBams).toBe(false);
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
