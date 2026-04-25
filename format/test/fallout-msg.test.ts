/**
 * Unit tests for fallout-msg/format.ts — whitespace-normalized .msg formatter.
 */

import { describe, expect, it } from "vitest";
import { formatMsg } from "@bgforge/format";

/** Apply the formatter and assert it produced a change. */
function fmt(text: string): string {
    const result = formatMsg(text);
    expect(result.warning).toBeUndefined();
    expect(result.text).not.toBe(text);
    return result.text;
}

/** Assert the formatter is a no-op on already-formatted text. */
function noop(text: string): void {
    const result = formatMsg(text);
    expect(result.warning).toBeUndefined();
    expect(result.text).toBe(text);
}

describe("fallout-msg/format", () => {
    it("trims whitespace inside number braces", () => {
        expect(fmt("{ 100 }{}{text}\n")).toBe("{100}{}{text}\n");
    });

    it("trims whitespace inside audio braces", () => {
        expect(fmt("{100}{ audio }{text}\n")).toBe("{100}{audio}{text}\n");
    });

    it("trims whitespace inside both number and audio braces", () => {
        expect(fmt("{ 100 }{ audio }{text}\n")).toBe("{100}{audio}{text}\n");
    });

    it("does not trim text content", () => {
        expect(fmt("{ 100 }{}{ text with spaces }\n")).toBe("{100}{}{ text with spaces }\n");
    });

    it("preserves empty fields", () => {
        noop("{100}{}{}\n");
    });

    it("preserves non-empty text verbatim", () => {
        noop("{100}{}{Hello world.}\n");
    });

    it("preserves audio field content when trimmed produces no change", () => {
        noop("{100}{audio_file}{Hello world.}\n");
    });

    it("preserves comment lines (non-{ lines) trimming trailing whitespace", () => {
        noop("This is a comment\n{100}{}{text}\n");
    });

    it("trims trailing whitespace from comment lines", () => {
        expect(fmt("This is a comment   \n{100}{}{text}\n")).toBe("This is a comment\n{100}{}{text}\n");
    });

    it("preserves a single blank line between entries", () => {
        noop("{100}{}{text}\n\n{200}{}{other}\n");
    });

    it("collapses multiple consecutive blank lines into one", () => {
        expect(fmt("{100}{}{text}\n\n\n{200}{}{other}\n")).toBe("{100}{}{text}\n\n{200}{}{other}\n");
    });

    it("collapses whitespace-only lines into a single blank line", () => {
        expect(fmt("{100}{}{text}\n   \n   \n{200}{}{other}\n")).toBe("{100}{}{text}\n\n{200}{}{other}\n");
    });

    it("handles multiline text content verbatim", () => {
        const input = "{100}{}{Hello\nworld}\n";
        noop(input);
    });

    it("does not trim whitespace inside multiline text", () => {
        const input = "{ 100 }{}{Hello\n  world  }\n";
        expect(fmt(input)).toBe("{100}{}{Hello\n  world  }\n");
    });

    it("preserves trailing newline when original has one", () => {
        noop("{100}{}{text}\n");
    });

    it("adds trailing newline when original lacks one", () => {
        const result = formatMsg("{ 100 }{}{text}");
        expect(result.text).toMatch(/\n$/);
    });

    it("strips BOM from output", () => {
        const result = formatMsg("\uFEFF{100}{}{text}\n");
        expect(result.text.startsWith("\uFEFF")).toBe(false);
        expect(result.text).toBe("{100}{}{text}\n");
    });

    it("is a no-op for already-formatted file", () => {
        noop("{100}{}{Hello world.}\n{200}{audio}{Goodbye.}\n");
    });

    it("formats multiple entries", () => {
        const input = "{ 100 }{}{text}\n{ 200 }{ snd }{other}\n";
        expect(fmt(input)).toBe("{100}{}{text}\n{200}{snd}{other}\n");
    });

    it("is a no-op for empty input", () => {
        expect(formatMsg("").text).toBe("");
    });

    // The safety check (entry-number mismatch → warning) is a defensive invariant:
    // the formatter only trims whitespace inside number/audio braces and never alters
    // entry numbers, so valid inputs cannot trigger it. These tests verify warning is
    // absent for edge cases most likely to stress the safety check.
    it("never emits a warning for entries with spaces in number field", () => {
        expect(formatMsg("{ 100 }{ 200 }{text}\n").warning).toBeUndefined();
    });

    it("never emits a warning for multiline text containing {digits}", () => {
        expect(formatMsg("{100}{}{line one\n{200} not an entry\nline three}\n{200}{}{real}\n").warning).toBeUndefined();
    });
});
