/**
 * Tests for shared provider helpers.
 * Validates symbol resolution, formatting, and completions.
 */

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/weidu-d";
import type { IndexedSymbol } from "../src/core/symbol";
import type { Symbols } from "../src/core/symbol-index";

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

// Test helpers to create mock symbols
function mockSymbol(name: string, uri: string | null = null): IndexedSymbol {
    return {
        name,
        source: { uri },
        completion: { label: name },
        hover: { contents: `hover for ${name}` },
        location: null,
    } as IndexedSymbol;
}

function mockSymbols(entries: Array<{ name: string; uri: string | null }>): Symbols {
    const symbolMap = new Map(entries.map((e) => [e.name, mockSymbol(e.name, e.uri)]));
    return {
        lookup: (name: string) => symbolMap.get(name),
        query: (opts: { excludeUri?: string }) => {
            const all = [...symbolMap.values()];
            if (opts.excludeUri) {
                return all.filter((s) => s.source.uri !== opts.excludeUri);
            }
            return all;
        },
    } as unknown as Symbols;
}

describe("resolveSymbolStatic", () => {
    let resolveSymbolStatic: typeof import("../src/shared/provider-helpers").resolveSymbolStatic;

    beforeEach(async () => {
        ({ resolveSymbolStatic } = await import("../src/shared/provider-helpers"));
    });

    it("returns undefined when symbols is undefined", () => {
        expect(resolveSymbolStatic("foo", undefined)).toBeUndefined();
    });

    it("looks up symbol by name", () => {
        const symbols = mockSymbols([{ name: "foo", uri: null }]);
        const result = resolveSymbolStatic("foo", symbols);
        expect(result?.name).toBe("foo");
    });

    it("returns undefined for unknown symbol", () => {
        const symbols = mockSymbols([{ name: "foo", uri: null }]);
        expect(resolveSymbolStatic("bar", symbols)).toBeUndefined();
    });
});

describe("resolveSymbolWithLocal", () => {
    let resolveSymbolWithLocal: typeof import("../src/shared/provider-helpers").resolveSymbolWithLocal;

    beforeEach(async () => {
        ({ resolveSymbolWithLocal } = await import("../src/shared/provider-helpers"));
    });

    it("returns local symbol when found", () => {
        const localSymbol = mockSymbol("foo", "file:///a.ts");
        const lookupLocal = vi.fn().mockReturnValue(localSymbol);
        const symbols = mockSymbols([{ name: "foo", uri: null }]);

        const result = resolveSymbolWithLocal("foo", "text", 1, "file:///a.ts", symbols, lookupLocal);
        expect(result).toBe(localSymbol);
        expect(lookupLocal).toHaveBeenCalledWith("foo", "text", 1, "file:///a.ts");
    });

    it("falls back to indexed symbol from different file", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([{ name: "foo", uri: "file:///other.ts" }]);

        const result = resolveSymbolWithLocal("foo", "text", 1, "file:///a.ts", symbols, lookupLocal);
        expect(result?.name).toBe("foo");
    });

    it("returns static symbol (null uri)", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([{ name: "foo", uri: null }]);

        const result = resolveSymbolWithLocal("foo", "text", 1, "file:///a.ts", symbols, lookupLocal);
        expect(result?.name).toBe("foo");
    });

    it("does NOT return indexed symbol from same file", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([{ name: "foo", uri: "file:///a.ts" }]);

        const result = resolveSymbolWithLocal("foo", "text", 1, "file:///a.ts", symbols, lookupLocal);
        expect(result).toBeUndefined();
    });

    it("returns undefined when symbol not found anywhere", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([]);

        const result = resolveSymbolWithLocal("foo", "text", 1, "file:///a.ts", symbols, lookupLocal);
        expect(result).toBeUndefined();
    });
});

describe("getStaticCompletions", () => {
    let getStaticCompletions: typeof import("../src/shared/provider-helpers").getStaticCompletions;

    beforeEach(async () => {
        ({ getStaticCompletions } = await import("../src/shared/provider-helpers"));
    });

    it("returns empty array when symbols is undefined", () => {
        expect(getStaticCompletions(undefined)).toEqual([]);
    });

    it("returns completion items from all symbols", () => {
        const symbols = mockSymbols([
            { name: "foo", uri: null },
            { name: "bar", uri: null },
        ]);
        const result = getStaticCompletions(symbols);
        expect(result).toHaveLength(2);
        expect(result[0]?.label).toBe("foo");
    });
});

describe("formatWithValidation", () => {
    let formatWithValidation: typeof import("../src/shared/provider-helpers").formatWithValidation;
    /** Real trees: the syntax-error check walks the tree, so a stand-in root would not exercise it. */
    const VALID_D = "BEGIN d\n";
    const dTree = (text: string) => parseWithCache(text);

    beforeAll(async () => {
        await initParser();
    });

    beforeEach(async () => {
        ({ formatWithValidation } = await import("../src/shared/provider-helpers"));
    });

    it("returns empty edits when parser not initialized", () => {
        const result = formatWithValidation({
            text: "code",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => false,
            parse: () => null,
            formatAst: () => ({ text: "" }),
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result.edits).toEqual([]);
    });

    it("returns empty edits when parse fails", () => {
        const result = formatWithValidation({
            text: "code",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => null,
            formatAst: () => ({ text: "" }),
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result.edits).toEqual([]);
    });

    it("skips a tree with a syntax error without a warning or a formatter call", () => {
        const formatAst = vi.fn(() => ({ text: "x" }));
        const result = formatWithValidation({
            text: "code",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => dTree("BEGIN d IF\n"),
            formatAst,
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result).toEqual({ edits: [] });
        expect(formatAst).not.toHaveBeenCalled();
    });

    // The grammar closes a state missing its END where the next state begins, which leaves no ERROR node; the
    // file is still broken.
    it("skips a tree whose state lacks its END in the same way", () => {
        const formatAst = vi.fn(() => ({ text: "x" }));
        const result = formatWithValidation({
            text: "code",
            uri: "file:///a.d",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => dTree("BEGIN d\nIF ~~ THEN BEGIN a SAY ~x~ IF ~~ THEN EXIT\nIF ~~ THEN BEGIN b SAY ~y~ END\n"),
            formatAst,
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result).toEqual({ edits: [] });
        expect(formatAst).not.toHaveBeenCalled();
    });

    it("returns edits on successful format", () => {
        const result = formatWithValidation({
            text: "  code  ",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => dTree(VALID_D),
            formatAst: () => ({ text: "code" }),
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result.edits).toHaveLength(1);
    });

    it("returns warning on formatter error", () => {
        const result = formatWithValidation({
            text: "code",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => dTree(VALID_D),
            formatAst: () => {
                throw new Error("parse fail");
            },
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result.edits).toEqual([]);
        expect(result.warning).toContain("TEST formatter error");
    });

    it("returns warning on validation failure (content changed)", () => {
        const result = formatWithValidation({
            text: "abc",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => dTree(VALID_D),
            formatAst: () => ({ text: "xyz" }),
            getFormatOptions: () => ({}),
            normalizeForCompare: (t: string) => t,
        });
        expect(result.edits).toEqual([]);
        expect(result.warning).toContain("TEST formatter validation failed");
    });
});
