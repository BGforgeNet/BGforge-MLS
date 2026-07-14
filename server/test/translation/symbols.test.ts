/**
 * Unit tests for translation/symbols.ts - document symbols and folding ranges for .tra/.msg files.
 */

import { describe, expect, it } from "vitest";
import { SymbolKind } from "vscode-languageserver/node";
import { getTranslationSymbols, getTranslationFoldingRanges } from "../../src/translation/symbols";

describe("translation/symbols", () => {
    describe("getTranslationSymbols() - tra", () => {
        const text = "@1 = ~One~\n@2 = ~Two\nThree~\n";

        it("returns one symbol per entry, named by its @N key", () => {
            const symbols = getTranslationSymbols(text, "tra");

            expect(symbols.length).toBe(2);
            expect(symbols[0]!.name).toBe("@1");
            expect(symbols[1]!.name).toBe("@2");
        });

        it("sets detail to the first line of the entry text", () => {
            const symbols = getTranslationSymbols(text, "tra");

            expect(symbols[0]!.detail).toBe("One");
            // Entry 2 spans two lines; detail is only the first.
            expect(symbols[1]!.detail).toBe("Two");
        });

        it("uses SymbolKind.String", () => {
            const symbols = getTranslationSymbols(text, "tra");

            expect(symbols[0]!.kind).toBe(SymbolKind.String);
            expect(symbols[1]!.kind).toBe(SymbolKind.String);
        });

        it("sets range to the full entry span, including multiline entries", () => {
            const symbols = getTranslationSymbols(text, "tra");

            expect(symbols[0]!.range).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
            });
            expect(symbols[1]!.range).toEqual({
                start: { line: 1, character: 0 },
                end: { line: 2, character: 6 },
            });
        });

        it("sets selectionRange to just the @N key", () => {
            const symbols = getTranslationSymbols(text, "tra");

            expect(symbols[0]!.selectionRange).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 0, character: 2 },
            });
            expect(symbols[1]!.selectionRange).toEqual({
                start: { line: 1, character: 0 },
                end: { line: 1, character: 2 },
            });
        });
    });

    describe("getTranslationSymbols() - msg", () => {
        const text = "{1}{}{One}\n{2}{}{Two\nThree}\n";

        it("returns one symbol per entry, named by its {N} key", () => {
            const symbols = getTranslationSymbols(text, "msg");

            expect(symbols.length).toBe(2);
            expect(symbols[0]!.name).toBe("{1}");
            expect(symbols[1]!.name).toBe("{2}");
        });

        it("sets detail to the first line of the entry text", () => {
            const symbols = getTranslationSymbols(text, "msg");

            expect(symbols[0]!.detail).toBe("One");
            expect(symbols[1]!.detail).toBe("Two");
        });

        it("sets range to the full entry span, including multiline entries", () => {
            const symbols = getTranslationSymbols(text, "msg");

            expect(symbols[0]!.range).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
            });
            expect(symbols[1]!.range).toEqual({
                start: { line: 1, character: 0 },
                end: { line: 2, character: 6 },
            });
        });

        it("sets selectionRange to just the {N} key", () => {
            const symbols = getTranslationSymbols(text, "msg");

            expect(symbols[0]!.selectionRange).toEqual({
                start: { line: 0, character: 0 },
                end: { line: 0, character: 3 },
            });
            expect(symbols[1]!.selectionRange).toEqual({
                start: { line: 1, character: 0 },
                end: { line: 1, character: 3 },
            });
        });
    });

    describe("getTranslationSymbols() - truncates a long first line for detail", () => {
        it("truncates detail past the length cutoff", () => {
            const longLine = "x".repeat(100);
            const text = `@1 = ~${longLine}~`;
            const symbols = getTranslationSymbols(text, "tra");

            // detail is optional on DocumentSymbol, but getTranslationSymbols always sets it.
            expect(symbols[0]!.detail!.length).toBeLessThan(longLine.length);
            expect(symbols[0]!.detail!.endsWith("...")).toBe(true);
        });
    });

    describe("getTranslationSymbols() - malformed and empty input", () => {
        it("returns an empty array for an empty file", () => {
            expect(getTranslationSymbols("", "tra")).toEqual([]);
            expect(getTranslationSymbols("", "msg")).toEqual([]);
        });

        it("returns an empty array for a tra entry missing its closing tilde", () => {
            expect(getTranslationSymbols("@1 = ~unterminated", "tra")).toEqual([]);
        });

        it("returns an empty array for content with no translation entries at all", () => {
            expect(getTranslationSymbols("this is not a translation file", "tra")).toEqual([]);
            expect(getTranslationSymbols("this is not a translation file", "msg")).toEqual([]);
        });

        it("returns partial results when only some entries in the file are well-formed", () => {
            const text = "@1 = ~Good~\n@2 = ~unterminated";
            const symbols = getTranslationSymbols(text, "tra");

            expect(symbols.length).toBe(1);
            expect(symbols[0]!.name).toBe("@1");
        });
    });

    describe("getTranslationFoldingRanges()", () => {
        it("produces no ranges for single-line entries", () => {
            const text = "@1 = ~One~\n@2 = ~Two~\n";
            expect(getTranslationFoldingRanges(text, "tra")).toEqual([]);
        });

        it("produces a range only for a multiline entry, with correct start/end lines", () => {
            const text = "@1 = ~One~\n@2 = ~Two\nThree~\n";
            const ranges = getTranslationFoldingRanges(text, "tra");

            expect(ranges).toEqual([{ startLine: 1, endLine: 2 }]);
        });

        it("produces one range per multiline entry when several are present", () => {
            const text = "@1 = ~One\nAnd more~\n@2 = ~Two~\n@3 = ~Three\nAnd more still~\n";
            const ranges = getTranslationFoldingRanges(text, "tra");

            expect(ranges).toEqual([
                { startLine: 0, endLine: 1 },
                { startLine: 3, endLine: 4 },
            ]);
        });

        it("works for msg entries the same way", () => {
            const text = "{1}{}{One}\n{2}{}{Two\nThree}\n";
            const ranges = getTranslationFoldingRanges(text, "msg");

            expect(ranges).toEqual([{ startLine: 1, endLine: 2 }]);
        });

        it("returns an empty array for an empty file", () => {
            expect(getTranslationFoldingRanges("", "tra")).toEqual([]);
            expect(getTranslationFoldingRanges("", "msg")).toEqual([]);
        });
    });
});
