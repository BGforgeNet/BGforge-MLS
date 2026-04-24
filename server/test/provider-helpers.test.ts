/**
 * Tests for shared provider helpers.
 * Validates symbol resolution, formatting, and completions.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CompletionItem } from "vscode-languageserver/node";
import type { IndexedSymbol } from "../src/core/symbol";
import type { Symbols } from "../src/core/symbol-index";

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn() },
    }),
}));

// Test helpers to create mock symbols
function mockSymbol(name: string, uri: string | null = null): IndexedSymbol {
    return {
        name,
        source: { uri },
        completion: { label: name } as CompletionItem,
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

        const result = resolveSymbolWithLocal("foo", "text", "file:///a.ts", symbols, lookupLocal);
        expect(result).toBe(localSymbol);
        expect(lookupLocal).toHaveBeenCalledWith("foo", "text", "file:///a.ts");
    });

    it("falls back to indexed symbol from different file", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([{ name: "foo", uri: "file:///other.ts" }]);

        const result = resolveSymbolWithLocal("foo", "text", "file:///a.ts", symbols, lookupLocal);
        expect(result?.name).toBe("foo");
    });

    it("returns static symbol (null uri)", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([{ name: "foo", uri: null }]);

        const result = resolveSymbolWithLocal("foo", "text", "file:///a.ts", symbols, lookupLocal);
        expect(result?.name).toBe("foo");
    });

    it("does NOT return indexed symbol from same file", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([{ name: "foo", uri: "file:///a.ts" }]);

        const result = resolveSymbolWithLocal("foo", "text", "file:///a.ts", symbols, lookupLocal);
        expect(result).toBeUndefined();
    });

    it("returns undefined when symbol not found anywhere", () => {
        const lookupLocal = vi.fn().mockReturnValue(undefined);
        const symbols = mockSymbols([]);

        const result = resolveSymbolWithLocal("foo", "text", "file:///a.ts", symbols, lookupLocal);
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
            stripComments: (t: string) => t,
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
            stripComments: (t: string) => t,
        });
        expect(result.edits).toEqual([]);
    });

    it("returns edits on successful format", () => {
        const result = formatWithValidation({
            text: "  code  ",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => ({ rootNode: {} }),
            formatAst: () => ({ text: "code" }),
            getFormatOptions: () => ({}),
            stripComments: (t: string) => t,
        });
        expect(result.edits).toHaveLength(1);
    });

    it("returns warning on formatter error", () => {
        const result = formatWithValidation({
            text: "code",
            uri: "file:///a.ts",
            languageName: "TEST",
            isInitialized: () => true,
            parse: () => ({ rootNode: {} }),
            formatAst: () => {
                throw new Error("parse fail");
            },
            getFormatOptions: () => ({}),
            stripComments: (t: string) => t,
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
            parse: () => ({ rootNode: {} }),
            formatAst: () => ({ text: "xyz" }),
            getFormatOptions: () => ({}),
            stripComments: (t: string) => t,
        });
        expect(result.edits).toEqual([]);
        expect(result.warning).toContain("TEST formatter validation failed");
    });
});
