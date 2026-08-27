import { describe, expect, it } from "vitest";
import type { Range } from "vscode-languageserver/node";
import type { StrRefSite } from "../src/ie-resources/strref-sites";
import { strRefHover, strRefInlayHints } from "../src/ie-resources/strref-features";

/** A site covering `text` on `line`, as findStrRefSites would report it. */
function site(strref: number, line: number, start = 20, length = 5): StrRefSite {
    return {
        strref,
        range: { start: { line, character: start }, end: { line, character: start + length } },
    };
}

const STRINGS: Record<number, string> = {
    1: "Hello",
    2: "A string long enough that the inlay label has to cut it short",
    3: "",
};
const resolve = (strref: number) => STRINGS[strref];

const lines = (from: number, to: number): Range => ({
    start: { line: from, character: 0 },
    end: { line: to, character: 0 },
});

describe("strRefInlayHints", () => {
    it("puts the resolved string right after the number", () => {
        const hints = strRefInlayHints([site(1, 4)], resolve, lines(0, 10));
        expect(hints).toHaveLength(1);
        expect(hints[0]?.label).toBe("/* Hello */");
        expect(hints[0]?.position).toEqual({ line: 4, character: 25 });
    });

    it("pads the hint on both sides so it does not run into the code", () => {
        const [hint] = strRefInlayHints([site(1, 0)], resolve, lines(0, 10));
        expect(hint?.paddingLeft).toBe(true);
        expect(hint?.paddingRight).toBe(true);
    });

    it("shortens a long string and moves the whole text to the tooltip", () => {
        const [hint] = strRefInlayHints([site(2, 0)], resolve, lines(0, 10));
        // 30 characters of preview, the last three being the ellipsis that marks the cut.
        expect(hint?.label).toBe("/* " + STRINGS[2]!.slice(0, 27) + "... */");
        expect(String(hint?.label).length).toBe("/*  */".length + 30);
        expect(hint?.tooltip).toEqual({ kind: "markdown", value: "```bgforge-mls-string\n" + STRINGS[2] + "\n```" });
    });

    it("adds no tooltip when the label already shows the whole string", () => {
        const [hint] = strRefInlayHints([site(1, 0)], resolve, lines(0, 10));
        expect(hint?.tooltip).toBeUndefined();
    });

    it("still shows a hint for a strref whose string is empty", () => {
        // The game does hold a blank string here; showing nothing would read as "unresolved" instead.
        const [hint] = strRefInlayHints([site(3, 0)], resolve, lines(0, 10));
        expect(hint?.label).toBe("/*  */");
    });

    it("shows nothing for a strref the game does not resolve", () => {
        expect(strRefInlayHints([site(99, 0)], resolve, lines(0, 10))).toEqual([]);
    });

    it("only returns hints for the requested line range", () => {
        const sites = [site(1, 0), site(1, 5), site(1, 20)];
        const hints = strRefInlayHints(sites, resolve, lines(3, 10));
        expect(hints.map((hint) => hint.position.line)).toEqual([5]);
    });
});

describe("strRefHover", () => {
    it("shows the string when the cursor is on the number", () => {
        const hover = strRefHover([site(1, 4)], resolve, { line: 4, character: 22 });
        expect(hover?.contents).toEqual({ kind: "markdown", value: "```bgforge-mls-string\nHello\n```" });
    });

    it("covers the number's first and last character", () => {
        expect(strRefHover([site(1, 4)], resolve, { line: 4, character: 20 })).toBeDefined();
        expect(strRefHover([site(1, 4)], resolve, { line: 4, character: 24 })).toBeDefined();
    });

    it("shows nothing when the cursor is off the number", () => {
        expect(strRefHover([site(1, 4)], resolve, { line: 4, character: 19 })).toBeUndefined();
        expect(strRefHover([site(1, 4)], resolve, { line: 4, character: 26 })).toBeUndefined();
        expect(strRefHover([site(1, 4)], resolve, { line: 5, character: 22 })).toBeUndefined();
    });

    it("shows nothing for a strref the game does not resolve", () => {
        expect(strRefHover([site(99, 4)], resolve, { line: 4, character: 22 })).toBeUndefined();
    });
});
