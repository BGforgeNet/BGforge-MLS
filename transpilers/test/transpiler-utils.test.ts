import { describe, expect, test } from "vitest";
import { getWordBoundaryRegex, substituteVars, type VarsContext } from "../common/transpiler-utils";

describe("getWordBoundaryRegex", () => {
    test("returns a global regex matching the bounded word", () => {
        const re = getWordBoundaryRegex("count");
        expect(re.source).toBe("\\bcount\\b");
        expect(re.flags).toBe("g");
        expect("for i = 0 to count step countup".match(re)).toEqual(["count"]);
    });

    test("returns the same instance for the same name (memoized)", () => {
        expect(getWordBoundaryRegex("foo")).toBe(getWordBoundaryRegex("foo"));
    });

    test("returns different instances for different names", () => {
        expect(getWordBoundaryRegex("foo")).not.toBe(getWordBoundaryRegex("bar"));
    });
});

describe("substituteVars", () => {
    test("replaces a variable token with its value", () => {
        const vars: VarsContext = new Map([["count", "5"]]);
        expect(substituteVars("i < count", vars)).toBe("i < 5");
    });

    test("respects word boundaries (does not replace partial matches)", () => {
        const vars: VarsContext = new Map([["i", "9"]]);
        expect(substituteVars("size + index", vars)).toBe("size + index");
    });

    test("substitutes multiple variables", () => {
        const vars: VarsContext = new Map([
            ["count", "5"],
            ["base", "10"],
        ]);
        expect(substituteVars("base + count", vars)).toBe("10 + 5");
    });

    test("returns text unchanged when no variables match", () => {
        const vars: VarsContext = new Map([["unused", "0"]]);
        expect(substituteVars("plain text", vars)).toBe("plain text");
    });
});
