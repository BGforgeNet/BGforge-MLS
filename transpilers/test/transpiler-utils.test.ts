import { describe, expect, test } from "vitest";
import {
    applyHelperFixups,
    evaluateCondition,
    extractTraTag,
    getWordBoundaryRegex,
    hasImports,
    makeGeneratedHeader,
    parseArrayLiteral,
    parseIncrement,
    stripQuotes,
    substituteVars,
    type VarsContext,
} from "../common/transpiler-utils";

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

describe("parseIncrement", () => {
    test("recognizes ++, --, +=N, -=N, and falls back to 1 for anything else", () => {
        expect(parseIncrement("i++")).toBe(1);
        expect(parseIncrement("i--")).toBe(-1);
        expect(parseIncrement("i += 5")).toBe(5);
        expect(parseIncrement("i -= 3")).toBe(-3);
        expect(parseIncrement("i")).toBe(1);
    });

    test("falls back to a step of 1/-1 when the +=/-= operand doesn't parse as a number", () => {
        expect(parseIncrement("i += x")).toBe(1);
        expect(parseIncrement("i -= x")).toBe(-1);
    });
});

describe("evaluateCondition", () => {
    const noVars: VarsContext = new Map();

    test("substitutes the loop variable and other compile-time vars before evaluating", () => {
        expect(evaluateCondition("i < count", "i", 5, new Map([["count", "10"]]))).toBe(true);
        expect(evaluateCondition("i < count", "i", 15, new Map([["count", "10"]]))).toBe(false);
    });

    test("coerces a numeric result to boolean", () => {
        expect(evaluateCondition("i", "i", 0, noVars)).toBe(false);
        expect(evaluateCondition("i", "i", 1, noVars)).toBe(true);
    });

    test("wraps an evaluation failure with the substituted text and loop variable", () => {
        expect(() => evaluateCondition("i ===", "i", 3, noVars)).toThrow(
            /Cannot evaluate loop condition "i ===" with i=3\. Substituted: "3 ==="/,
        );
    });
});

describe("stripQuotes", () => {
    test("folds double, single, and backtick quoting to the same bare content", () => {
        expect(stripQuotes('"hello"')).toBe("hello");
        expect(stripQuotes("'hello'")).toBe("hello");
        expect(stripQuotes("`hello`")).toBe("hello");
        expect(stripQuotes("hello")).toBe("hello");
    });
});

describe("hasImports", () => {
    test("detects a leading import statement", () => {
        expect(hasImports('import { X } from "y";\nconst z = 1;')).toBe(true);
    });

    test("detects a re-export-all statement", () => {
        expect(hasImports('export * from "y";\n')).toBe(true);
    });

    test("returns false for source with no import/re-export statements", () => {
        expect(hasImports("const z = 1;\nfunction f() {}\n")).toBe(false);
    });
});

describe("extractTraTag", () => {
    test("extracts the filename from a single-line @tra JSDoc", () => {
        expect(extractTraTag("/** @tra smarter_familiars.tra */\nconst x = 1;")).toBe("smarter_familiars.tra");
    });

    test("extracts the filename from inside a multi-line JSDoc block", () => {
        expect(extractTraTag("/**\n * @tra strings.msg\n */\n")).toBe("strings.msg");
    });

    test("returns undefined when no @tra tag is present", () => {
        expect(extractTraTag("const x = 1;\n")).toBeUndefined();
    });
});

describe("applyHelperFixups", () => {
    test('resolves obj("[X]") and $obj("[X]") to a bracketed object reference', () => {
        expect(applyHelperFixups('obj("[ANYONE]")')).toBe("[ANYONE]");
        expect(applyHelperFixups('$obj("[ANYONE]")')).toBe("[ANYONE]");
    });

    test('resolves obj("str") to a quoted string literal', () => {
        expect(applyHelperFixups('obj("hello")')).toBe('"hello"');
    });

    test("resolves tra(N) to an @N translation reference", () => {
        expect(applyHelperFixups("tra(42)")).toBe("@42");
        expect(applyHelperFixups("$tra(42)")).toBe("@42");
    });

    test("resolves tlk(N) to a bare number (no # prefix)", () => {
        expect(applyHelperFixups("tlk(1234)")).toBe("1234");
    });

    test("quotes a bare WeiDU scope constant", () => {
        expect(applyHelperFixups("GLOBAL")).toBe('"GLOBAL"');
    });

    test("converts [x, y] comma notation to BAF's dot-separated point notation, including negatives", () => {
        expect(applyHelperFixups("[2791, 831]")).toBe("[2791.831]");
        expect(applyHelperFixups("[-1, -1]")).toBe("[-1.-1]");
    });

    test("is idempotent on already-resolved values", () => {
        const once = applyHelperFixups("tra(1)");
        expect(applyHelperFixups(once)).toBe(once);
    });

    test("throws on input far longer than any real WeiDU arg", () => {
        const huge = "x".repeat(5000);
        expect(() => applyHelperFixups(huge)).toThrow(/exceeds 4096/);
    });
});

describe("parseArrayLiteral", () => {
    test("parses a simple literal into element strings", () => {
        expect(parseArrayLiteral('["foo", "bar"]')).toEqual(['"foo"', '"bar"']);
    });

    test("keeps nested array elements intact", () => {
        expect(parseArrayLiteral("[[1, 2], [3, 4]]")).toEqual(["[1, 2]", "[3, 4]"]);
    });

    test("does not split on a comma inside a quoted string", () => {
        expect(parseArrayLiteral('["a, b", "c"]')).toEqual(['"a, b"', '"c"']);
    });

    test("returns an empty array for an empty literal", () => {
        expect(parseArrayLiteral("[]")).toEqual([]);
    });

    test("returns null for text that isn't bracketed", () => {
        expect(parseArrayLiteral("not-an-array")).toBeNull();
    });
});

describe("makeGeneratedHeader", () => {
    test("verbose form includes the source name and a leading @tra line when given", () => {
        const header = makeGeneratedHeader("foo.tssl", "foo.tra");
        expect(header).toBe(
            "/** @tra foo.tra */\n/* Do not edit. This file is generated from foo.tssl. Make your changes there and regenerate this file. */\n\n",
        );
    });

    test("omits the @tra line when no tag is given", () => {
        expect(makeGeneratedHeader("foo.tssl", undefined)).not.toContain("@tra");
    });

    test("terse form (TD) uses the one-line 'Generated from' wording", () => {
        expect(makeGeneratedHeader("foo.td", undefined, true)).toBe("/* Generated from foo.td - do not edit */\n\n");
    });
});
