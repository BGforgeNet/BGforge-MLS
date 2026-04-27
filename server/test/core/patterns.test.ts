/**
 * Branch-coverage tests for core/patterns.ts.
 *
 * The pattern regexes are exercised indirectly by translation/inlay-hint
 * tests; the digit-entry guards on REGEX_TRA_REF / REGEX_MSG_REF are not.
 * Without the throw branch covered, any future change that loosens the guard
 * (turning it into a regex-injection surface) goes unnoticed.
 */

import { describe, expect, it } from "vitest";
import {
    REGEX_MSG_HOVER,
    REGEX_MSG_INLAY,
    REGEX_MSG_INLAY_FLOATER_RAND,
    REGEX_MSG_REF,
    REGEX_TRA_COMMENT,
    REGEX_TRA_COMMENT_EXT,
    REGEX_TRA_HOVER,
    REGEX_TRA_INLAY,
    REGEX_TRA_REF,
    REGEX_TRANSPILER_TRA_HOVER,
    REGEX_TRANSPILER_TRA_INLAY,
} from "../../src/core/patterns";

describe("REGEX_TRA_REF / REGEX_MSG_REF: digit-entry guard", () => {
    it("REGEX_TRA_REF accepts a digit string", () => {
        expect(() => REGEX_TRA_REF("42")).not.toThrow();
    });

    it("REGEX_TRA_REF rejects a non-digit entry (regex-injection guard)", () => {
        expect(() => REGEX_TRA_REF("4)|.*")).toThrow(/digits only/);
        expect(() => REGEX_TRA_REF("abc")).toThrow(/digits only/);
        expect(() => REGEX_TRA_REF("")).toThrow(/digits only/);
        expect(() => REGEX_TRA_REF("1 2")).toThrow(/digits only/);
    });

    it("REGEX_MSG_REF accepts a digit string", () => {
        expect(() => REGEX_MSG_REF("123")).not.toThrow();
    });

    it("REGEX_MSG_REF rejects non-digit entry", () => {
        expect(() => REGEX_MSG_REF("abc")).toThrow(/digits only/);
        expect(() => REGEX_MSG_REF("1)\\d+")).toThrow(/digits only/);
    });
});

describe("REGEX_TRA_REF: regex behaviour", () => {
    it("matches @42 in source text", () => {
        const re = REGEX_TRA_REF("42");
        const matches = "use @42 here, also @421".match(re);
        // Only @42 should match — @421 fails the (?!\\d) lookahead.
        expect(matches).toEqual(["@42"]);
    });

    it("matches tra(42) syntax too", () => {
        const re = REGEX_TRA_REF("42");
        expect("call tra(42) please".match(re)).toEqual(["tra(42)"]);
    });

    it("does not match unrelated numbers", () => {
        const re = REGEX_TRA_REF("42");
        expect("number 99 elsewhere".match(re)).toBeNull();
    });
});

describe("REGEX_MSG_REF: regex behaviour", () => {
    it("matches mstr(123) and Reply(123)", () => {
        const re = REGEX_MSG_REF("123");
        const out = "mstr(123) and Reply(123) and NOption(99) ".match(re);
        expect(out).toContain("mstr(123");
        expect(out).toContain("Reply(123");
    });

    it("matches floater_rand second-arg form", () => {
        const re = REGEX_MSG_REF("7");
        const out = "floater_rand(99, 7)".match(re);
        expect(out).not.toBeNull();
    });

    it("rejects partial-prefix matches via (?!\\d)", () => {
        const re = REGEX_MSG_REF("12");
        // mstr(123) should NOT count as a match for entry 12 — the lookahead blocks it.
        expect("mstr(123)".match(re)).toBeNull();
    });
});

describe("hover and inlay regex constants", () => {
    it("REGEX_TRA_HOVER matches @\\d+ exactly", () => {
        expect(REGEX_TRA_HOVER.test("@42")).toBe(true);
        expect(REGEX_TRA_HOVER.test("@42 ")).toBe(false);
        expect(REGEX_TRA_HOVER.test("not @42")).toBe(false);
    });

    it("REGEX_MSG_HOVER matches MSG-function prefix", () => {
        expect(REGEX_MSG_HOVER.test("mstr(123")).toBe(true);
        expect(REGEX_MSG_HOVER.test("NOption(7")).toBe(true);
        expect(REGEX_MSG_HOVER.test("foo(123")).toBe(false);
    });

    it("REGEX_TRANSPILER_TRA_HOVER matches tra(N) form", () => {
        expect(REGEX_TRANSPILER_TRA_HOVER.test("tra(42)")).toBe(true);
        expect(REGEX_TRANSPILER_TRA_HOVER.test("tra(42")).toBe(false);
    });

    it("REGEX_TRA_INLAY scans across text", () => {
        const matches = [..."start @1 middle @99 end".matchAll(REGEX_TRA_INLAY)];
        expect(matches.length).toBe(2);
    });

    it("REGEX_MSG_INLAY scans MSG calls in text", () => {
        const matches = [..."mstr(1) and BMessage(2) here".matchAll(REGEX_MSG_INLAY)];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("REGEX_MSG_INLAY_FLOATER_RAND captures both args", () => {
        const matches = [..."floater_rand(1, 2)".matchAll(REGEX_MSG_INLAY_FLOATER_RAND)];
        expect(matches.length).toBe(1);
        expect(matches[0]![1]).toBe("1");
        expect(matches[0]![2]).toBe("2");
    });

    it("REGEX_TRANSPILER_TRA_INLAY scans tra(N) tokens", () => {
        const matches = [..."tra(1) and tra(7)".matchAll(REGEX_TRANSPILER_TRA_INLAY)];
        expect(matches.length).toBe(2);
    });

    it("REGEX_TRA_COMMENT extracts filename and ext", () => {
        const m = "/** @tra strings.tra */".match(REGEX_TRA_COMMENT);
        expect(m).not.toBeNull();
        expect(m![1]).toBe("strings.tra");
        expect(m![2]).toBe("strings");
        expect(m![3]).toBe("tra");
    });

    it("REGEX_TRA_COMMENT_EXT captures only ext", () => {
        const m = "/** @tra strings.msg */".match(REGEX_TRA_COMMENT_EXT);
        expect(m).not.toBeNull();
        expect(m![1]).toBe("msg");
    });
});
