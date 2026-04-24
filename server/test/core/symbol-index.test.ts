/**
 * Tests for core/symbol-index.ts - Symbols storage and query operations.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { type IndexedSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";

// =============================================================================
// Test fixtures
// =============================================================================

function createSymbol(overrides: Partial<IndexedSymbol> & { name: string }): IndexedSymbol {
    return {
        name: overrides.name,
        kind: overrides.kind ?? SymbolKind.Variable,
        location:
            "location" in overrides
                ? overrides.location
                : {
                      uri: "file:///test.txt",
                      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                  },
        scope: overrides.scope ?? { level: ScopeLevel.File },
        source: overrides.source ?? { type: SourceType.Document, uri: "file:///test.txt" },
        completion: overrides.completion ?? {
            label: overrides.name,
            kind: CompletionItemKind.Variable,
        },
        hover: overrides.hover ?? {
            contents: { kind: "markdown", value: `variable ${overrides.name}` },
        },
        signature: overrides.signature,
    };
}

describe("Symbols", () => {
    let index: Symbols;

    beforeEach(() => {
        index = new Symbols();
    });

    // =========================================================================
    // Storage operations
    // =========================================================================
    describe("updateFile()", () => {
        it("should store symbols for a file", () => {
            const symbols = [createSymbol({ name: "x" }), createSymbol({ name: "y" })];

            index.updateFile("file:///test.txt", symbols);

            const result = index.getFileSymbols("file:///test.txt");
            expect(result).toHaveLength(2);
            expect(result.map((s) => s.name)).toContain("x");
            expect(result.map((s) => s.name)).toContain("y");
        });

        it("should replace symbols when updating same file", () => {
            const oldSymbols = [createSymbol({ name: "old" })];
            const newSymbols = [createSymbol({ name: "new" })];

            index.updateFile("file:///test.txt", oldSymbols);
            index.updateFile("file:///test.txt", newSymbols);

            const result = index.getFileSymbols("file:///test.txt");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("new");
        });

        it("should keep symbols from other files when updating", () => {
            index.updateFile("file:///a.txt", [createSymbol({ name: "a" })]);
            index.updateFile("file:///b.txt", [createSymbol({ name: "b" })]);

            const resultA = index.getFileSymbols("file:///a.txt");
            const resultB = index.getFileSymbols("file:///b.txt");

            expect(resultA).toHaveLength(1);
            expect(resultA[0].name).toBe("a");
            expect(resultB).toHaveLength(1);
            expect(resultB[0].name).toBe("b");
        });

        it("should handle empty symbol array", () => {
            index.updateFile("file:///test.txt", [createSymbol({ name: "x" })]);
            index.updateFile("file:///test.txt", []);

            const result = index.getFileSymbols("file:///test.txt");
            expect(result).toHaveLength(0);
        });
    });

    describe("clearFile()", () => {
        it("should remove all symbols from a file", () => {
            index.updateFile("file:///test.txt", [createSymbol({ name: "x" }), createSymbol({ name: "y" })]);

            index.clearFile("file:///test.txt");

            const result = index.getFileSymbols("file:///test.txt");
            expect(result).toHaveLength(0);
        });

        it("should not affect other files", () => {
            index.updateFile("file:///a.txt", [createSymbol({ name: "a" })]);
            index.updateFile("file:///b.txt", [createSymbol({ name: "b" })]);

            index.clearFile("file:///a.txt");

            expect(index.getFileSymbols("file:///a.txt")).toHaveLength(0);
            expect(index.getFileSymbols("file:///b.txt")).toHaveLength(1);
        });

        it("should be idempotent for non-existent files", () => {
            // Should not throw
            index.clearFile("file:///nonexistent.txt");
            expect(index.getFileSymbols("file:///nonexistent.txt")).toHaveLength(0);
        });
    });

    describe("getFileSymbols()", () => {
        it("should return empty array for unknown file", () => {
            const result = index.getFileSymbols("file:///unknown.txt");
            expect(result).toEqual([]);
        });

        it("should return symbols in insertion order", () => {
            const symbols = [
                createSymbol({ name: "first" }),
                createSymbol({ name: "second" }),
                createSymbol({ name: "third" }),
            ];

            index.updateFile("file:///test.txt", symbols);

            const result = index.getFileSymbols("file:///test.txt");
            expect(result.map((s) => s.name)).toEqual(["first", "second", "third"]);
        });

        it("should return the same array reference (no defensive copy)", () => {
            index.updateFile("file:///test.txt", [createSymbol({ name: "x" })]);

            const result1 = index.getFileSymbols("file:///test.txt");
            const result2 = index.getFileSymbols("file:///test.txt");

            expect(result1).toBe(result2);
        });
    });

    describe("loadStatic()", () => {
        it("should store static symbols", () => {
            const staticSymbols = [
                createSymbol({
                    name: "builtin_func",
                    kind: SymbolKind.Function,
                    source: { type: SourceType.Static, uri: null },
                    scope: { level: ScopeLevel.Global },
                }),
            ];

            index.loadStatic(staticSymbols);

            const result = index.lookup("builtin_func");
            expect(result).toBeDefined();
            expect(result?.name).toBe("builtin_func");
        });

        it("should replace existing static symbols on reload", () => {
            index.loadStatic([
                createSymbol({
                    name: "func",
                    source: { type: SourceType.Static, uri: null },
                }),
            ]);
            index.loadStatic([
                createSymbol({
                    name: "other_func",
                    source: { type: SourceType.Static, uri: null },
                }),
            ]);

            expect(index.lookup("func")).toBeUndefined();
            expect(index.lookup("other_func")).toBeDefined();
        });
    });

    // =========================================================================
    // Query operations
    // =========================================================================
    describe("lookup()", () => {
        it("should find symbol by exact name", () => {
            index.updateFile("file:///test.txt", [createSymbol({ name: "target" }), createSymbol({ name: "other" })]);

            const result = index.lookup("target");

            expect(result).toBeDefined();
            expect(result?.name).toBe("target");
        });

        it("should return undefined for non-existent symbol", () => {
            index.updateFile("file:///test.txt", [createSymbol({ name: "exists" })]);

            const result = index.lookup("nonexistent");

            expect(result).toBeUndefined();
        });

        it("should find symbol across multiple files", () => {
            index.updateFile("file:///a.txt", [createSymbol({ name: "in_a" })]);
            index.updateFile("file:///b.txt", [createSymbol({ name: "in_b" })]);

            expect(index.lookup("in_a")).toBeDefined();
            expect(index.lookup("in_b")).toBeDefined();
        });

        it("should find static symbols", () => {
            index.loadStatic([
                createSymbol({
                    name: "static_func",
                    source: { type: SourceType.Static, uri: null },
                }),
            ]);

            const result = index.lookup("static_func");
            expect(result).toBeDefined();
        });

        it("should prioritize document symbols over static", () => {
            index.loadStatic([
                createSymbol({
                    name: "shared",
                    source: { type: SourceType.Static, uri: null },
                    scope: { level: ScopeLevel.Global },
                }),
            ]);
            index.updateFile("file:///test.txt", [
                createSymbol({
                    name: "shared",
                    source: { type: SourceType.Document, uri: "file:///test.txt" },
                    scope: { level: ScopeLevel.File },
                }),
            ]);

            const result = index.lookup("shared", { uri: "file:///test.txt" });

            expect(result).toBeDefined();
            expect(result?.source.type).toBe(SourceType.Document);
        });
    });

    describe("lookupDefinition()", () => {
        it("should return location for symbols with valid URIs", () => {
            index.updateFile("file:///test.txt", [
                createSymbol({
                    name: "my_func",
                    location: {
                        uri: "file:///test.txt",
                        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
                    },
                }),
            ]);

            const result = index.lookupDefinition("my_func");

            expect(result).not.toBeNull();
            expect(result?.uri).toBe("file:///test.txt");
            expect(result?.range.start.line).toBe(5);
        });

        it("should return null for static symbols with null location", () => {
            index.loadStatic([
                createSymbol({
                    name: "builtin_func",
                    source: { type: SourceType.Static, uri: null },
                    location: null, // Static symbols have no source file
                }),
            ]);

            const result = index.lookupDefinition("builtin_func");

            // Should return null since static symbols have no navigable location
            expect(result).toBeNull();
        });

        it("should return null for non-existent symbols", () => {
            const result = index.lookupDefinition("nonexistent");
            expect(result).toBeNull();
        });
    });

    describe("query()", () => {
        beforeEach(() => {
            index.updateFile("file:///test.txt", [
                createSymbol({ name: "foo_var", kind: SymbolKind.Variable }),
                createSymbol({ name: "foo_func", kind: SymbolKind.Function }),
                createSymbol({ name: "bar_var", kind: SymbolKind.Variable }),
                createSymbol({ name: "FOO_CONST", kind: SymbolKind.Constant }),
            ]);
        });

        it("should return all symbols with no filters", () => {
            const result = index.query({});
            expect(result).toHaveLength(4);
        });

        it("should filter by prefix", () => {
            const result = index.query({ prefix: "bar" });

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("bar_var");
        });

        it("should filter by prefix case-insensitively", () => {
            const result = index.query({ prefix: "FOO" });

            expect(result).toHaveLength(3); // foo_var, foo_func, FOO_CONST
        });

        it("should filter by kind", () => {
            const result = index.query({ kinds: [SymbolKind.Variable] });

            expect(result).toHaveLength(2);
            expect(result.every((s) => s.kind === SymbolKind.Variable)).toBe(true);
        });

        it("should filter by multiple kinds", () => {
            const result = index.query({ kinds: [SymbolKind.Variable, SymbolKind.Constant] });

            expect(result).toHaveLength(3);
        });

        it("should respect limit", () => {
            const result = index.query({ limit: 2 });
            expect(result).toHaveLength(2);
        });

        it("should combine prefix and kind filters", () => {
            const result = index.query({ prefix: "foo", kinds: [SymbolKind.Function] });

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("foo_func");
        });

        it("should filter by uri", () => {
            index.updateFile("file:///other.txt", [
                createSymbol({
                    name: "other_sym",
                    source: { type: SourceType.Document, uri: "file:///other.txt" },
                }),
            ]);

            const result = index.query({ uri: "file:///test.txt" });

            expect(result).toHaveLength(4);
            expect(result.find((s) => s.name === "other_sym")).toBeUndefined();
        });

        it("should include static symbols unless uri filter excludes them", () => {
            index.loadStatic([
                createSymbol({
                    name: "static_sym",
                    source: { type: SourceType.Static, uri: null },
                }),
            ]);

            const allResult = index.query({});
            expect(allResult.find((s) => s.name === "static_sym")).toBeDefined();

            const filteredResult = index.query({ uri: "file:///test.txt" });
            // Static symbols should still be included when filtering by uri
            // because they're visible everywhere
            expect(filteredResult.find((s) => s.name === "static_sym")).toBeDefined();
        });

        it("should exclude symbols from excludeUri", () => {
            // Add symbols to a second file
            index.updateFile("file:///header.tph", [
                createSymbol({
                    name: "header_func",
                    kind: SymbolKind.Function,
                    source: { type: SourceType.Workspace, uri: "file:///header.tph" },
                }),
            ]);

            // Query without exclusion - should include both files
            const allResult = index.query({});
            expect(allResult.find((s) => s.name === "foo_var")).toBeDefined();
            expect(allResult.find((s) => s.name === "header_func")).toBeDefined();

            // Query with excludeUri - should exclude that file's symbols
            const excludedResult = index.query({ excludeUri: "file:///test.txt" });
            expect(excludedResult.find((s) => s.name === "foo_var")).toBeUndefined();
            expect(excludedResult.find((s) => s.name === "header_func")).toBeDefined();
        });

        it("should still include static symbols when using excludeUri", () => {
            index.loadStatic([
                createSymbol({
                    name: "builtin_func",
                    source: { type: SourceType.Static, uri: null },
                }),
            ]);

            const result = index.query({ excludeUri: "file:///test.txt" });

            // Static symbols are stored separately (not in files map), so excludeUri doesn't apply.
            // Context-based filtering (action/patch) is a separate layer in the provider.
            expect(result.find((s) => s.name === "builtin_func")).toBeDefined();
            // File symbols with matching URI are excluded
            expect(result.find((s) => s.name === "foo_var")).toBeUndefined();
        });

        it("query({}) returns identical results across calls and invalidates on update", () => {
            const symbols = new Symbols();
            for (let f = 0; f < 5; f++) {
                const uri = `file:///mod/f${f}.tp2`;
                symbols.updateFile(uri, [
                    createSymbol({ name: `a${f}`, source: { type: SourceType.Workspace, uri } }),
                    createSymbol({ name: `b${f}`, source: { type: SourceType.Workspace, uri } }),
                ]);
            }
            symbols.loadStatic([
                createSymbol({ name: "static1", source: { type: SourceType.Static, uri: null } }),
                createSymbol({ name: "static2", source: { type: SourceType.Static, uri: null } }),
            ]);

            const first = [...symbols.query({})].map((s) => s.name).sort();
            const second = [...symbols.query({})].map((s) => s.name).sort();
            expect(second).toEqual(first);

            // Invalidate by update: results change accordingly.
            const uri0 = "file:///mod/f0.tp2";
            symbols.updateFile(uri0, [createSymbol({ name: "new_only", source: { type: SourceType.Workspace, uri: uri0 } })]);
            const third = [...symbols.query({})].map((s) => s.name);
            expect(third).not.toContain("a0");
            expect(third).toContain("new_only");
        });

        it("searchWorkspaceSymbols returns consistent results across calls", () => {
            const symbols = new Symbols();
            for (let f = 0; f < 3; f++) {
                const uri = `file:///mod/f${f}.tp2`;
                symbols.updateFile(uri, [createSymbol({ name: `fn_${f}`, source: { type: SourceType.Workspace, uri } })]);
            }
            const first = symbols.searchWorkspaceSymbols("fn").map((s) => s.name).sort();
            const second = symbols.searchWorkspaceSymbols("fn").map((s) => s.name).sort();
            expect(second).toEqual(first);
        });
    });

    // =========================================================================
    // Same-name resolution and ordering stability
    // =========================================================================
    describe("same-name symbols from different headers", () => {
        it("lookupAll returns both symbols when two headers define same name", () => {
            const symA = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///a.h" },
                scope: { level: ScopeLevel.Workspace },
            });
            const symB = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///b.h" },
                scope: { level: ScopeLevel.Workspace },
            });

            index.updateFile("file:///a.h", [symA]);
            index.updateFile("file:///b.h", [symB]);

            const results = index.lookupAll("SHARED");
            expect(results).toHaveLength(2);
        });

        it("lookupAll returns deterministic order based on URI for same-scope symbols", () => {
            const symA = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///a.h" },
                scope: { level: ScopeLevel.Workspace },
            });
            const symB = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///b.h" },
                scope: { level: ScopeLevel.Workspace },
            });

            index.updateFile("file:///a.h", [symA]);
            index.updateFile("file:///b.h", [symB]);

            const results = index.lookupAll("SHARED");
            // URI ordering: file:///a.h comes before file:///b.h alphabetically
            expect(results[0]!.source.uri).toBe("file:///a.h");
            expect(results[1]!.source.uri).toBe("file:///b.h");
        });

        it("reload does not change resolution order", () => {
            const symA = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///a.h" },
                scope: { level: ScopeLevel.Workspace },
            });
            const symB = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///b.h" },
                scope: { level: ScopeLevel.Workspace },
            });

            index.updateFile("file:///a.h", [symA]);
            index.updateFile("file:///b.h", [symB]);

            const before = index.lookupAll("SHARED").map((s) => s.source.uri);

            // Simulate file reload (re-updating a.h)
            const symAReloaded = createSymbol({
                name: "SHARED",
                kind: SymbolKind.Constant,
                source: { type: SourceType.Workspace, uri: "file:///a.h" },
                scope: { level: ScopeLevel.Workspace },
            });
            index.updateFile("file:///a.h", [symAReloaded]);

            const after = index.lookupAll("SHARED").map((s) => s.source.uri);

            // Order should be the same after reload
            expect(after).toEqual(before);
        });

        it("scope precedence: Document > Static > Workspace", () => {
            // Static symbol
            index.loadStatic([
                createSymbol({
                    name: "SHARED",
                    source: { type: SourceType.Static, uri: null },
                    scope: { level: ScopeLevel.Global },
                }),
            ]);

            // Workspace symbol from header
            index.updateFile("file:///header.h", [
                createSymbol({
                    name: "SHARED",
                    source: { type: SourceType.Workspace, uri: "file:///header.h" },
                    scope: { level: ScopeLevel.Workspace },
                }),
            ]);

            // Document symbol from current file
            index.updateFile("file:///current.txt", [
                createSymbol({
                    name: "SHARED",
                    source: { type: SourceType.Document, uri: "file:///current.txt" },
                    scope: { level: ScopeLevel.File },
                }),
            ]);

            // With context pointing to current file, document symbol should win
            const result = index.lookup("SHARED", { uri: "file:///current.txt" });
            expect(result).toBeDefined();
            expect(result!.source.type).toBe(SourceType.Document);

            // All three should be in lookupAll
            const all = index.lookupAll("SHARED", { uri: "file:///current.txt" });
            expect(all).toHaveLength(3);
            // First should be document (highest precedence with same-file bonus)
            expect(all[0]!.source.type).toBe(SourceType.Document);
        });
    });

    // =========================================================================
    // Scope-aware queries (basic - detailed tests in separate file)
    // =========================================================================
    describe("getVisibleSymbols()", () => {
        it("should return symbols visible at file scope", () => {
            index.updateFile("file:///test.txt", [
                createSymbol({
                    name: "file_var",
                    scope: { level: ScopeLevel.File },
                }),
            ]);
            index.loadStatic([
                createSymbol({
                    name: "static_func",
                    scope: { level: ScopeLevel.Global },
                    source: { type: SourceType.Static, uri: null },
                }),
            ]);

            const result = index.getVisibleSymbols("file:///test.txt");

            expect(result.map((s) => s.name)).toContain("file_var");
            expect(result.map((s) => s.name)).toContain("static_func");
        });

        it("should not include symbols from other files at file scope", () => {
            index.updateFile("file:///a.txt", [
                createSymbol({
                    name: "a_var",
                    scope: { level: ScopeLevel.File },
                    source: { type: SourceType.Document, uri: "file:///a.txt" },
                }),
            ]);
            index.updateFile("file:///b.txt", [
                createSymbol({
                    name: "b_var",
                    scope: { level: ScopeLevel.File },
                    source: { type: SourceType.Document, uri: "file:///b.txt" },
                }),
            ]);

            const result = index.getVisibleSymbols("file:///a.txt");

            expect(result.map((s) => s.name)).toContain("a_var");
            expect(result.map((s) => s.name)).not.toContain("b_var");
        });

        it("should include workspace-scoped symbols from headers", () => {
            index.updateFile("file:///header.h", [
                createSymbol({
                    name: "header_func",
                    scope: { level: ScopeLevel.Workspace },
                    source: { type: SourceType.Workspace, uri: "file:///header.h" },
                }),
            ]);

            const result = index.getVisibleSymbols("file:///test.txt");

            expect(result.map((s) => s.name)).toContain("header_func");
        });
    });
});
