/**
 * Unit tests for fallout-scripts-lst/format.ts — column-aligned scripts.lst formatter.
 * Output always uses CRLF line endings.
 */

import { describe, expect, it } from "vitest";
import { formatScriptsLst } from "../../src/fallout-scripts-lst/format";

/** Apply the formatter and assert it produced a change. */
function fmt(text: string): string {
    const result = formatScriptsLst(text);
    expect(result.warning).toBeUndefined();
    expect(result.text).not.toBe(text);
    return result.text;
}

/** Assert the formatter is a no-op on already-formatted text. */
function noop(text: string): void {
    const result = formatScriptsLst(text);
    expect(result.warning).toBeUndefined();
    expect(result.text).toBe(text);
}

/** Shorthand: convert LF string to CRLF for use in expected values. */
function crlf(text: string): string {
    return text.replace(/\n/g, "\r\n");
}

describe("fallout-scripts-lst/format", () => {
    it("is a no-op for empty input", () => {
        expect(formatScriptsLst("").text).toBe("");
    });

    it("is a no-op for a single filename-only line (CRLF)", () => {
        noop("AR0100.int\r\n");
    });

    it("is a no-op for a line with comment and no metadata (CRLF)", () => {
        noop("AR0100.int    ; Arroyo\r\n");
    });

    it("is a no-op for a line with comment and metadata (CRLF)", () => {
        noop("AR0100.int    ; Arroyo    # local_vars=0\r\n");
    });

    it("normalizes LF input to CRLF output", () => {
        const result = formatScriptsLst("AR0100.int\n");
        expect(result.text).toBe("AR0100.int\r\n");
    });

    it("adds trailing CRLF when original lacks a newline", () => {
        const result = formatScriptsLst("AR0100.int");
        expect(result.text).toMatch(/\r\n$/);
    });

    it("trims trailing whitespace from filename-only line", () => {
        expect(fmt("AR0100.int   \r\n")).toBe("AR0100.int\r\n");
    });

    it("normalizes extra space after ; to single space", () => {
        expect(fmt("AR0100.int  ;  Arroyo\r\n")).toBe("AR0100.int    ; Arroyo\r\n");
    });

    it("normalizes extra space after # to single space", () => {
        expect(fmt("AR0100.int  ; Arroyo  #  local_vars=0\r\n")).toBe("AR0100.int    ; Arroyo    # local_vars=0\r\n");
    });

    it("aligns filename column using MIN_GAP=4 from widest filename", () => {
        // Widest filename is "LONGER.int" (10 chars); shorter one pads to 10+4=14
        const input = crlf("AB.int  ; short\nLONGER.int  ; long\n");
        const result = fmt(input);
        const lines = result.split("\r\n");
        expect(lines[0]).toBe("AB.int        ; short");
        expect(lines[1]).toBe("LONGER.int    ; long");
    });

    it("aligns comment column using MIN_GAP=4 from widest comment when metadata present", () => {
        const input = crlf("A.int  ; short  # meta\nB.int  ; a much longer comment  # meta\n");
        const result = fmt(input);
        const lines = result.split("\r\n");
        // comment field is padded to maxCommentWidth (23) + MIN_GAP (4) = 27 chars
        const commentStart0 = lines[0]!.indexOf("; short");
        const metaStart0 = lines[0]!.indexOf("# meta");
        expect(metaStart0 - commentStart0).toBe(27);
    });

    it("does not pad comment column when no metadata present", () => {
        const input = crlf("A.int  ; short\nB.int  ; longer comment\n");
        const result = fmt(input);
        const lines = result.split("\r\n");
        expect(lines[0]).toBe("A.int    ; short");
        expect(lines[1]).toBe("B.int    ; longer comment");
    });

    it("preserves comment-only and blank lines, trimming trailing whitespace", () => {
        noop(crlf("// This is a comment\nAR0100.int\n\n"));
    });

    it("trims trailing whitespace from non-data lines", () => {
        expect(fmt(crlf("// comment   \nAR0100.int\n"))).toBe(crlf("// comment\nAR0100.int\n"));
    });

    it("strips BOM from output", () => {
        const result = formatScriptsLst("\uFEFFAR0100.int\r\n");
        expect(result.text.startsWith("\uFEFF")).toBe(false);
        expect(result.text).toBe("AR0100.int\r\n");
    });

    it("is idempotent: formatting an already-formatted CRLF file is a no-op", () => {
        noop(crlf("AB.int        ; short\nLONGER.int    ; long\n"));
    });

    it("is idempotent: double-formatting equals single-formatting", () => {
        const input = crlf("AB.int  ; short  # meta\nLONGER.int  ; long comment  # local_vars=3\n");
        const once = fmt(input);
        noop(once);
    });

    it("is idempotent on CRLF input that is already formatted", () => {
        const input = "AR0100.int    ; Arroyo    # local_vars=0\r\n";
        noop(input);
    });

    // The token-mismatch safety branch is a defensive invariant: the formatter only
    // rearranges whitespace and cannot alter filename/comment/metadata tokens. Valid
    // inputs cannot trigger the warning branch, so we verify it is absent for
    // boundary inputs most likely to stress the safety check.
    it("never emits a warning for a line with all three columns", () => {
        expect(formatScriptsLst("AR0100.int  ; Arroyo  # local_vars=5\r\n").warning).toBeUndefined();
    });

    it("never emits a warning for a file with mixed line types", () => {
        const input = crlf("// header\n\nAR0100.int\nAR0200.int  ; Klamath\nAR0300.int  ; Den  # local_vars=2\n");
        expect(formatScriptsLst(input).warning).toBeUndefined();
    });
});
