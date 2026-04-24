/**
 * Unit tests for weidu-tra/format.ts — whitespace-normalized .tra formatter.
 */

import { describe, expect, it } from "vitest";
import { formatTra } from "../../src/weidu-tra/format";

/** Apply the formatter and assert it produced a change. */
function fmt(text: string): string {
    const result = formatTra(text);
    expect(result.warning).toBeUndefined();
    expect(result.edits.length).toBeGreaterThan(0);
    return result.edits[0]?.newText ?? text;
}

/** Assert the formatter is a no-op on already-formatted text. */
function noop(text: string): void {
    const result = formatTra(text);
    expect(result.warning).toBeUndefined();
    expect(result.edits).toEqual([]);
}

describe("weidu-tra/format", () => {
    it("normalizes space between @ and number (removes space)", () => {
        expect(fmt("@ 100 = ~text~\n")).toBe("@100 = ~text~\n");
    });

    it("normalizes missing space after = sign", () => {
        expect(fmt("@100=~text~\n")).toBe("@100 = ~text~\n");
    });

    it("normalizes multiple spaces around =", () => {
        expect(fmt("@100  =  ~text~\n")).toBe("@100 = ~text~\n");
    });

    it("normalizes all three at once: space after @, no spaces around =", () => {
        expect(fmt("@ 100=~text~\n")).toBe("@100 = ~text~\n");
    });

    it("preserves tilde-delimited string content verbatim", () => {
        const input = "@1 = ~Hello   world~\n";
        // String content preserved, only prefix normalized if needed
        noop(input);
    });

    it("preserves double-quoted strings when already formatted", () => {
        noop('@1 = "Hello world"\n');
    });

    it("normalizes prefix with double-quoted string", () => {
        expect(fmt('@ 1 = "Hello world"\n')).toBe('@1 = "Hello world"\n');
    });

    it("preserves sound refs", () => {
        noop("@2 = ~Foo~ [FOO]\n");
    });

    it("preserves sound refs and female text", () => {
        noop("@11 = ~Male~ [MALE] ~Female~ [FEMALE]\n");
    });

    it("normalizes prefix when sound refs are present", () => {
        expect(fmt("@ 2 = ~Foo~ [FOO]\n")).toBe("@2 = ~Foo~ [FOO]\n");
    });

    it("preserves female text (two strings)", () => {
        noop("@10 = ~Male~ ~Female~\n");
    });

    it("handles negative numbers", () => {
        expect(fmt("@ -1 = ~text~\n")).toBe("@-1 = ~text~\n");
    });

    it("handles negative numbers already formatted", () => {
        noop("@-1 = ~text~\n");
    });

    it("preserves multiline tilde strings verbatim", () => {
        const input = "@1 = ~line one\nline two\nline three~\n";
        noop(input);
    });

    it("normalizes prefix of entry with multiline string", () => {
        const input = "@ 1 = ~line one\nline two~\n";
        expect(fmt(input)).toBe("@1 = ~line one\nline two~\n");
    });

    it("preserves comment lines (// style) trimming trailing whitespace", () => {
        noop("// This is a comment\n@1 = ~text~\n");
    });

    it("trims trailing whitespace from comment lines", () => {
        expect(fmt("// comment   \n@1 = ~text~\n")).toBe("// comment\n@1 = ~text~\n");
    });

    it("preserves block comments", () => {
        noop("/* block comment */\n@1 = ~text~\n");
    });

    it("trims trailing whitespace from block comment lines", () => {
        expect(fmt("/* block */   \n@1 = ~text~\n")).toBe("/* block */\n@1 = ~text~\n");
    });

    it("preserves trailing newline when original has one", () => {
        noop("@1 = ~text~\n");
    });

    it("adds trailing newline when original lacks one", () => {
        const result = formatTra("@ 1 = ~text~");
        expect(result.edits[0]?.newText).toMatch(/\n$/);
    });

    it("strips BOM from output", () => {
        const result = formatTra("\uFEFF@1 = ~text~\n");
        expect(result.edits[0]?.newText.startsWith("\uFEFF")).toBe(false);
        expect(result.edits[0]?.newText).toBe("@1 = ~text~\n");
    });

    it("is a no-op for already-formatted file", () => {
        noop("@100 = ~text~\n@200 = ~other~\n");
    });

    it("formats multiple entries", () => {
        const input = "@ 100 = ~text~\n@ 200=~other~\n";
        expect(fmt(input)).toBe("@100 = ~text~\n@200 = ~other~\n");
    });

    it("preserves a single blank line between entries", () => {
        noop("@1 = ~text~\n\n@2 = ~other~\n");
    });

    it("collapses multiple consecutive blank lines into one", () => {
        expect(fmt("@1 = ~text~\n\n\n@2 = ~other~\n")).toBe("@1 = ~text~\n\n@2 = ~other~\n");
    });

    it("collapses whitespace-only lines into a single blank line", () => {
        expect(fmt("@1 = ~text~\n   \n   \n@2 = ~other~\n")).toBe("@1 = ~text~\n\n@2 = ~other~\n");
    });

    // The safety check (entry-number mismatch → warning) is a defensive invariant:
    // the formatter only touches whitespace and never alters entry numbers, so valid
    // inputs cannot trigger it. These tests verify warning is absent for edge cases
    // most likely to stress the safety check.
    it("never emits a warning for entries with messy whitespace", () => {
        expect(formatTra("@ 1 = ~text~\n@  -2  =  ~other~\n").warning).toBeUndefined();
    });

    it("never emits a warning for multiline strings", () => {
        expect(formatTra("@1 = ~line one\n@2 = fake entry inside string~\n@3 = ~real~\n").warning).toBeUndefined();
    });

    it("returns empty edits for empty input", () => {
        expect(formatTra("").edits).toEqual([]);
    });
});
