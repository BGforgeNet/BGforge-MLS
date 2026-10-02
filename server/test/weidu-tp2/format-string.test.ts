import { describe, expect, it, beforeAll } from "vitest";
import { formatWeiduTp2 as formatDocument } from "@bgforge/format";
import { initParser, getParser } from "@bgforge/shared/parsers/weidu-tp2";

describe("weidu-tp2 format string literal preservation", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("should preserve newlines in OUTER_SPRINT strings with tildes", () => {
        const input = "OUTER_SPRINT NewLine ~\n~\n";
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        expect(result.text).toBe(input);
    });

    it("should preserve newlines in OUTER_SPRINT strings with quotes", () => {
        const input = 'OUTER_SPRINT NewLine "\n"\n';
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        expect(result.text).toBe(input);
    });

    it("should preserve newlines in OUTER_SPRINT strings with five tildes", () => {
        const input = "OUTER_SPRINT NewLine ~~~~~\n~~~~~\n";
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        expect(result.text).toBe(input);
    });

    it("should preserve multiple spaces in strings", () => {
        const input = "OUTER_SPRINT spaces ~  multiple   spaces  ~\n";
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        expect(result.text).toBe(input);
    });

    it("should preserve newlines in variable references with percents (if they exist)", () => {
        // While %var% usually doesn't have newlines, we should be safe.
        const input = "OUTER_SET x = % \n %\n";
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        // Note: OUTER_SET might use a different formatter, let's see.
        expect(result.text).toBe(input);
    });

    it("should preserve space between two strings", () => {
        const input = "COPY ~src~ ~dst~\n";
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        expect(result.text).toBe(input);
    });

    it("leaves // inside a string alone - a URL is not a comment", () => {
        const input = "PRINT ~see http://example.com/page~\n";
        const root = getParser().parse(input)!.rootNode;
        expect(formatDocument(root).text).toBe(input);
    });

    it("still normalizes a real comment that follows a string holding //", () => {
        const input = "PRINT ~http://example.com/page~ //note\n";
        const root = getParser().parse(input)!.rootNode;
        // Two spaces before an inline comment: INLINE_COMMENT_SPACING.
        expect(formatDocument(root).text).toBe("PRINT ~http://example.com/page~  // note\n");
    });

    it("should NOT add space between two strings if none existed", () => {
        const input = "COPY ~src~~dst~\n";
        const root = getParser().parse(input)!.rootNode;
        const result = formatDocument(root);
        expect(result.text).toBe(input);
    });
});
