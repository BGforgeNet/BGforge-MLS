/**
 * Tests for IE-specific Liquid-stripping and HTML-to-text utility functions.
 * Shared helper tests (cmpStr, litscal, findFiles) are in utils/test/yaml-helpers.test.ts.
 */

import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, htmlInlineToText, normalizeHtmlFragment, stripLiquid } from "../src/ie/common.ts";

describe("stripLiquid", () => {
    it("removes capture note tags", () => {
        const input = "{% capture note %}Some note{% endcapture %} {% include note.html %}";
        expect(stripLiquid(input)).toBe("Some note");
    });

    it("removes capture info tags", () => {
        const input = "{% capture note %}Some info{% endcapture %} {% include info.html %}";
        expect(stripLiquid(input)).toBe("Some info");
    });

    it("leaves plain text unchanged", () => {
        expect(stripLiquid("plain text")).toBe("plain text");
    });
});

describe("decodeHtmlEntities", () => {
    it("decodes hex numeric character references (&#x...;)", () => {
        expect(decodeHtmlEntities("&#x41;")).toBe("A");
        expect(decodeHtmlEntities("&#x4F;")).toBe("O");
    });

    it("decodes decimal numeric character references (&#...;)", () => {
        expect(decodeHtmlEntities("&#65;")).toBe("A");
        expect(decodeHtmlEntities("&#79;")).toBe("O");
    });

    it("passes through unknown named entities unchanged", () => {
        expect(decodeHtmlEntities("&unknown;")).toBe("&unknown;");
    });
});

describe("htmlInlineToText", () => {
    it("strips tags and decodes entities", () => {
        expect(htmlInlineToText("<code>&#x41;</code>")).toBe("A");
    });

    it("strips nested tags without leaving residual brackets", () => {
        // CodeQL js/incomplete-multi-character-sanitization: greedy /<[^>]+>/g
        // matches `<bar<baz>` in `<bar<baz>>` and leaves a stray `>` behind.
        expect(htmlInlineToText("foo<bar<baz>>quux")).toBe("fooquux");
    });
});

describe("normalizeHtmlFragment compactBlankLines: false", () => {
    it("trims without collapsing blank lines when compactBlankLines is false", () => {
        const html = "  hello  ";
        const result = normalizeHtmlFragment(html, {
            resolveHref: (h: string) => h,
            compactBlankLines: false,
        });
        // Should trim but not compact blank lines
        expect(result).toBe("hello");
    });

    it("preserves multiple blank lines when compactBlankLines is false", () => {
        const html = "line1<br /><br /><br />line2";
        const result = normalizeHtmlFragment(html, {
            resolveHref: (h: string) => h,
            compactBlankLines: false,
        });
        // Three <br> = three newlines - not collapsed
        expect(result).toContain("\n\n\n");
    });

    it("strips nested tags without leaving residual brackets", () => {
        // CodeQL js/incomplete-multi-character-sanitization: same shape as
        // htmlInlineToText - greedy single-pass strip leaves stray brackets.
        const result = normalizeHtmlFragment("foo<bar<baz>>quux", {
            resolveHref: (h: string) => h,
            compactBlankLines: false,
        });
        expect(result).toBe("fooquux");
    });
});
