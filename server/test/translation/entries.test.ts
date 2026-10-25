/**
 * Unit tests for translation/entries.ts - the index of `.tra` and `.msg` entries behind hover, inlay hints,
 * definitions and references. A `.tra` file is indexed the way the installer reads it, a `.msg` file the way
 * the game loads it: an entry the installer or the game would not see is not indexed, and one it would is.
 */

import { describe, expect, it } from "vitest";
import { getLineKey, parseEntries } from "../../src/translation/entries";

/** The entry texts by number, the part of the index every consumer reads. */
function sources(text: string, ext: "tra" | "msg"): Record<string, string> {
    return Object.fromEntries([...parseEntries(text, ext)].map(([num, entry]) => [num, entry.source]));
}

describe("translation/entries - tra", () => {
    it("indexes the tilde, double-quote and percent forms", () => {
        const text = '@1 = ~tilde~\n@2 = "double"\n@3 = %percent%\n';
        expect(sources(text, "tra")).toEqual({ 1: "tilde", 2: "double", 3: "percent" });
    });

    it("reads a five-tilde string whole, tildes inside it included", () => {
        expect(sources("@1 = ~~~~~has ~ a tilde~~~~~\n", "tra")).toEqual({ 1: "has ~ a tilde" });
    });

    it("indexes an empty string and an empty five-tilde string as empty text", () => {
        expect(sources("@1 = ~~\n@2 = ~~~~~~~~~~\n", "tra")).toEqual({ 1: "", 2: "" });
    });

    it("indexes a negative entry number", () => {
        expect(sources("@-5 = ~minus~\n", "tra")).toEqual({ "-5": "minus" });
    });

    it("joins strings written with ^", () => {
        expect(sources('@1 = ~a~ ^ "b" ^ ~c~\n', "tra")).toEqual({ 1: "abc" });
    });

    it("indexes a bare word as the text", () => {
        expect(sources("@1 = bareword\n", "tra")).toEqual({ 1: "bareword" });
    });

    it("takes the male string of an entry with a sound and a female string", () => {
        expect(sources("@1 = ~male~ [SND1] ~female~ [SND2]\n@2 = ~next~\n", "tra")).toEqual({ 1: "male", 2: "next" });
    });

    it("ignores an entry inside a line comment", () => {
        expect(sources("// @1 = ~old~\n@2 = ~live~\n", "tra")).toEqual({ 2: "live" });
    });

    it("ignores an entry inside a block comment, nested ones included", () => {
        const text = "/* @1 = ~a~ */\n/* outer /* inner */ @2 = ~b~ */\n@3 = ~live~\n";
        expect(sources(text, "tra")).toEqual({ 3: "live" });
    });

    it("lets a commented-out entry leave a live one of the same number alone", () => {
        expect(sources("@1 = ~live~\n// @1 = ~old~\n", "tra")).toEqual({ 1: "live" });
    });

    it("does not read an entry out of the text of a string", () => {
        expect(sources('@1 = "has\n@9 = ~x~ inside"\n@2 = ~two~\n', "tra")).toEqual({
            1: "has\n@9 = ~x~ inside",
            2: "two",
        });
    });

    it("does not read comment markers inside a string as a comment", () => {
        expect(sources("@1 = ~a // b /* c~\n@2 = ~two~\n", "tra")).toEqual({ 1: "a // b /* c", 2: "two" });
    });

    it("resolves an @N value to the text of that entry", () => {
        expect(sources("@1 = ~one~\n@2 = @1\n", "tra")).toEqual({ 1: "one", 2: "one" });
    });

    it("keeps the entries around a malformed one", () => {
        expect(sources("@1 = ~one~\n@oops\n@3 = ~three~\n", "tra")).toEqual({ 1: "one", 3: "three" });
    });

    it("leaves out an entry whose string is never closed, and keeps the entries around it", () => {
        const text = '@1 = ~one~\n@2 = "unclosed\n@3 = ~three~\n@4 = %four%\n';
        expect(sources(text, "tra")).toEqual({ 1: "one", 3: "three", 4: "four" });
    });

    it("lets the last of two entries with one number win", () => {
        expect(sources("@1 = ~a~\n@1 = ~b~\n", "tra")).toEqual({ 1: "b" });
    });

    it("records where each entry starts and ends", () => {
        const entry = parseEntries("// note\n@7 = ~two\nlines~ [SND]\n", "tra").get("7")!;
        expect([entry.line, entry.character, entry.endLine, entry.endCharacter]).toEqual([1, 0, 2, 6]);
    });

    it("keeps a bare reference as the text of an entry that names a missing one", () => {
        expect(sources("@1 = @9\n@2 = #5\n", "tra")).toEqual({ 1: "@9", 2: "#5" });
    });

    it("does not take the next entry for the value of an entry still being typed", () => {
        expect(sources("@1 =\n@2 = ~two~\n", "tra")).toEqual({ 2: "two" });
    });

    it("reads a reference by the key a consumer looks up", () => {
        expect(getLineKey("@12", "tra")).toBe("12");
    });
});

describe("translation/entries - msg", () => {
    it("indexes an audio field holding a space", () => {
        expect(sources("{800}{Weapon Damage}{Light}\n", "msg")).toEqual({ 800: "Light" });
    });

    it("indexes an entry on a line starting with #, as the game loads it", () => {
        expect(sources("# {200}{}{live}\n{100}{}{hello}\n", "msg")).toEqual({ 100: "hello", 200: "live" });
    });

    it("indexes signed numbers and leading zeros by their value", () => {
        expect(sources("{-5}{}{minus}\n{+6}{}{plus}\n{007}{}{zeros}\n", "msg")).toEqual({
            "-5": "minus",
            6: "plus",
            7: "zeros",
        });
    });

    it("indexes junk between the fields as the game loads it", () => {
        expect(sources("{100} one {} two {text}\n", "msg")).toEqual({ 100: "text" });
    });

    it("keeps multi-line text, with its newlines", () => {
        expect(sources("{100}{}{line one\nline two}\n", "msg")).toEqual({ 100: "line one\nline two" });
    });

    it("lets the last of two entries with one number win", () => {
        expect(sources("{100}{}{a}\n{100}{}{b}\n", "msg")).toEqual({ 100: "b" });
    });

    it("does not index an entry the game refuses to read", () => {
        const longText = "x".repeat(1024);
        expect(sources(`{ 1 }{}{padded}\n{2}{}{${longText}}\n{3}{}{fine}\n`, "msg")).toEqual({ 3: "fine" });
    });

    it("records where each entry starts and ends", () => {
        const entry = parseEntries("# note\n{7}{}{two\nlines}\n", "msg").get("7")!;
        expect([entry.line, entry.character, entry.endLine, entry.endCharacter]).toEqual([1, 0, 2, 6]);
    });
});
