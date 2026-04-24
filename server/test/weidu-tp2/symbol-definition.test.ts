/**
 * Tests for weidu-tp2 getSymbolDefinition behavior.
 *
 * Ensures that static symbols (built-in functions) return null
 * instead of a Location with empty URI.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { type Location } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { loadStaticSymbols } from "../../src/core/static-loader";
import { validLocationOrNull } from "../../src/core/location-utils";
import { type IndexedSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";

// Mock fs and common to avoid file system and LSP dependencies
vi.mock("fs", () => ({
    readFileSync: vi.fn().mockReturnValue(
        JSON.stringify([
            {
                label: "DELETE_EFFECT",
                kind: 3, // CompletionItemKind.Function
                category: "functions",
                documentation: { kind: "markdown", value: "Deletes an effect" },
            },
            {
                label: "COPY_EXISTING",
                kind: 14, // CompletionItemKind.Keyword
                category: "keywords",
            },
        ]),
    ),
}));

vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

describe("weidu-tp2 getSymbolDefinition", () => {
    let symbols: Symbols;

    beforeEach(() => {
        symbols = new Symbols();
        const staticSymbols = loadStaticSymbols("weidu-tp2");
        symbols.loadStatic(staticSymbols);
    });

    it("returns null for static symbols (no navigable location)", () => {
        // Static symbols exist in the index
        const symbol = symbols.lookup("DELETE_EFFECT");
        expect(symbol).toBeDefined();

        // But their location is null (no source file)
        expect(symbol?.location).toBeNull();

        // So lookupDefinition should return null
        const result = symbols.lookupDefinition("DELETE_EFFECT");
        expect(result).toBeNull();
    });

    it("returns null for keywords (no navigable location)", () => {
        const symbol = symbols.lookup("COPY_EXISTING");
        expect(symbol).toBeDefined();
        expect(symbol?.location).toBeNull();

        const result = symbols.lookupDefinition("COPY_EXISTING");
        expect(result).toBeNull();
    });

    it("returns valid location for document symbols", () => {
        // Add a document symbol with a real location
        const documentSymbol: IndexedSymbol = {
            name: "my_custom_function",
            kind: SymbolKind.Function,
            callable: {},
            location: {
                uri: "file:///workspace/lib/utils.tph",
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 18 } },
            },
            scope: { level: ScopeLevel.File },
            source: { type: SourceType.Document, uri: "file:///workspace/lib/utils.tph" },
            completion: { label: "my_custom_function" },
            hover: { contents: { kind: "markdown", value: "Custom function" } },
        };

        symbols.updateFile("file:///workspace/lib/utils.tph", [documentSymbol]);

        const symbol = symbols.lookup("my_custom_function");
        expect(symbol).toBeDefined();
        expect(symbol?.location?.uri).toBe("file:///workspace/lib/utils.tph");

        const result = symbols.lookupDefinition("my_custom_function");
        expect(result).not.toBeNull();
        expect(result?.uri).toBe("file:///workspace/lib/utils.tph");
    });
});

describe("validLocationOrNull", () => {
    it("returns null for null input", () => {
        expect(validLocationOrNull(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
        expect(validLocationOrNull(undefined)).toBeNull();
    });

    it("returns null for empty URI", () => {
        const location: Location = {
            uri: "",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        };
        expect(validLocationOrNull(location)).toBeNull();
    });

    it("returns the location for valid file URI", () => {
        const location: Location = {
            uri: "file:///path/to/file.ts",
            range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
        };
        const result = validLocationOrNull(location);
        expect(result).toBe(location);
        expect(result?.uri).toBe("file:///path/to/file.ts");
    });

    it("returns the location for http URI", () => {
        const location: Location = {
            uri: "http://example.com/file.ts",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        };
        expect(validLocationOrNull(location)).toBe(location);
    });
});
