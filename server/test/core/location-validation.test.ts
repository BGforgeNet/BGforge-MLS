/**
 * Tests for Location validation in providers.
 *
 * Ensures that providers don't return Location objects with empty URIs,
 * which causes VSCode to try opening the workspace root directory.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { type Location } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { type Symbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";

/**
 * Validates that a Location is suitable for VSCode navigation.
 * Returns true if the location can be navigated to, false otherwise.
 */
function isValidLocation(location: Location | null | undefined): boolean {
    if (!location) return false;
    if (!location.uri || location.uri === "") return false;
    return true;
}

describe("Location validation", () => {
    describe("isValidLocation helper", () => {
        it("returns false for null", () => {
            expect(isValidLocation(null)).toBe(false);
        });

        it("returns false for undefined", () => {
            expect(isValidLocation(undefined)).toBe(false);
        });

        it("returns false for empty URI", () => {
            const location: Location = {
                uri: "",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            };
            expect(isValidLocation(location)).toBe(false);
        });

        it("returns true for valid file URI", () => {
            const location: Location = {
                uri: "file:///path/to/file.ts",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            };
            expect(isValidLocation(location)).toBe(true);
        });
    });

    describe("Symbols.lookup() for static symbols", () => {
        let index: Symbols;

        beforeEach(() => {
            index = new Symbols();
        });

        it("static symbols have null location (no source file)", () => {
            const staticSymbol: Symbol = {
                name: "DELETE_EFFECT",
                kind: SymbolKind.Function,
                location: null, // Static symbols have no source file
                scope: { level: ScopeLevel.Global },
                source: { type: SourceType.Static, uri: null },
                completion: { label: "DELETE_EFFECT" },
                hover: { contents: { kind: "markdown", value: "Deletes an effect" } },
            };

            index.loadStatic([staticSymbol]);

            const found = index.lookup("DELETE_EFFECT");
            expect(found).toBeDefined();
            expect(found?.location).toBeNull();
            expect(isValidLocation(found?.location)).toBe(false);
        });

        it("document symbols have valid URIs", () => {
            const documentSymbol: Symbol = {
                name: "my_function",
                kind: SymbolKind.Function,
                location: {
                    uri: "file:///path/to/file.tph",
                    range: { start: { line: 10, character: 0 }, end: { line: 10, character: 11 } },
                },
                scope: { level: ScopeLevel.File },
                source: { type: SourceType.Document, uri: "file:///path/to/file.tph" },
                completion: { label: "my_function" },
                hover: { contents: { kind: "markdown", value: "User function" } },
            };

            index.updateFile("file:///path/to/file.tph", [documentSymbol]);

            const found = index.lookup("my_function");
            expect(found).toBeDefined();
            expect(found?.location?.uri).toBe("file:///path/to/file.tph");
            expect(isValidLocation(found?.location)).toBe(true);
        });
    });

    describe("lookupDefinition returns null for static symbols", () => {
        it("returns null for static symbols (prevents VSCode directory open)", () => {
            const index = new Symbols();
            const staticSymbol: Symbol = {
                name: "COPY_EXISTING",
                kind: SymbolKind.Function,
                location: null, // Static symbols have no source file
                scope: { level: ScopeLevel.Global },
                source: { type: SourceType.Static, uri: null },
                completion: { label: "COPY_EXISTING" },
                hover: { contents: { kind: "markdown", value: "Copies a file" } },
            };

            index.loadStatic([staticSymbol]);

            // The symbol exists for hover/completion...
            const symbol = index.lookup("COPY_EXISTING");
            expect(symbol).toBeDefined();

            // ...but lookupDefinition returns null (not navigable)
            const definition = index.lookupDefinition("COPY_EXISTING");
            expect(definition).toBeNull();
        });

        it("returns valid location for document symbols", () => {
            const index = new Symbols();
            const documentSymbol: Symbol = {
                name: "my_function",
                kind: SymbolKind.Function,
                location: {
                    uri: "file:///path/to/file.tph",
                    range: { start: { line: 10, character: 0 }, end: { line: 10, character: 11 } },
                },
                scope: { level: ScopeLevel.File },
                source: { type: SourceType.Document, uri: "file:///path/to/file.tph" },
                completion: { label: "my_function" },
                hover: { contents: { kind: "markdown", value: "User function" } },
            };

            index.updateFile("file:///path/to/file.tph", [documentSymbol]);

            const definition = index.lookupDefinition("my_function");
            expect(definition).not.toBeNull();
            expect(definition?.uri).toBe("file:///path/to/file.tph");
        });
    });
});
