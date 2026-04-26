/**
 * Tests for workspace symbol search in Symbols (merged from WorkspaceSymbolIndex).
 *
 * Tests that Symbols can serve the Ctrl+T workspace symbol feature:
 * - Navigation-only symbols are stored and searchable
 * - Navigation symbols are excluded from completion queries
 * - Case-insensitive substring search works correctly
 */

import { describe, expect, it, beforeEach } from "vitest";
import { CompletionItemKind, SymbolKind as VscodeSymbolKind } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { type IndexedSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";
import { normalizeUri } from "../../src/core/normalized-uri";

// =============================================================================
// Test fixtures
// =============================================================================

const URI_A = "file:///workspace/a.ssl";
const URI_B = "file:///workspace/b.ssl";
const URI_HEADER = "file:///workspace/lib.h";

function createSymbol(
    name: string,
    overrides?: Partial<{
        kind: SymbolKind;
        sourceType: SourceType;
        uri: string | null;
        scopeLevel: ScopeLevel;
        displayPath: string;
    }>,
): IndexedSymbol {
    const uri = overrides?.uri ?? URI_A;
    const sourceType = overrides?.sourceType ?? SourceType.Navigation;
    return {
        name,
        kind: overrides?.kind ?? SymbolKind.Procedure,
        location: {
            uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
        },
        scope: { level: overrides?.scopeLevel ?? ScopeLevel.Workspace },
        source: { type: sourceType, uri, displayPath: overrides?.displayPath },
        completion: { label: name, kind: CompletionItemKind.Function },
        hover: { contents: { kind: "markdown", value: name } },
    } as IndexedSymbol;
}

// =============================================================================
// Tests
// =============================================================================

describe("Symbols — workspace symbol search", () => {
    let index: Symbols;

    beforeEach(() => {
        index = new Symbols();
    });

    // =========================================================================
    // SourceType.Navigation exclusion from query()
    // =========================================================================

    describe("query() excludes Navigation symbols", () => {
        it("should not return Navigation symbols in query results", () => {
            index.updateFile(normalizeUri(URI_A), [createSymbol("nav_proc", { sourceType: SourceType.Navigation })]);

            const results = index.query({});
            expect(results.find((s) => s.name === "nav_proc")).toBeUndefined();
        });

        it("should still return Workspace, Static, and Document symbols", () => {
            index.updateFile(normalizeUri(URI_HEADER), [
                createSymbol("header_proc", { sourceType: SourceType.Workspace, uri: URI_HEADER }),
            ]);
            index.updateFile(normalizeUri(URI_A), [createSymbol("doc_proc", { sourceType: SourceType.Document })]);
            index.loadStatic([createSymbol("builtin_func", { sourceType: SourceType.Static, uri: null })]);

            const results = index.query({});
            expect(results.find((s) => s.name === "header_proc")).toBeDefined();
            expect(results.find((s) => s.name === "doc_proc")).toBeDefined();
            expect(results.find((s) => s.name === "builtin_func")).toBeDefined();
        });

        it("should exclude Navigation even with prefix filter", () => {
            index.updateFile(normalizeUri(URI_A), [
                createSymbol("my_nav_proc", { sourceType: SourceType.Navigation }),
                createSymbol("my_header_proc", { sourceType: SourceType.Workspace }),
            ]);

            const results = index.query({ prefix: "my_" });
            expect(results).toHaveLength(1);
            expect(results[0]!.name).toBe("my_header_proc");
        });
    });

    // =========================================================================
    // searchWorkspaceSymbols()
    // =========================================================================

    describe("searchWorkspaceSymbols()", () => {
        beforeEach(() => {
            index.updateFile(normalizeUri(URI_A), [
                createSymbol("calculate_damage"),
                createSymbol("apply_armor"),
                createSymbol("MY_MACRO", { kind: SymbolKind.Macro }),
            ]);
            index.updateFile(normalizeUri(URI_B), [
                createSymbol("calculate_hit_chance", { uri: URI_B }),
                createSymbol("get_armor_class", { uri: URI_B }),
            ]);
        });

        it("should return all symbols for empty query", () => {
            const results = index.searchWorkspaceSymbols("");
            expect(results).toHaveLength(5);
        });

        it("should filter by case-insensitive substring", () => {
            const results = index.searchWorkspaceSymbols("calc");
            expect(results).toHaveLength(2);
            expect(results.map((s) => s.name)).toContain("calculate_damage");
            expect(results.map((s) => s.name)).toContain("calculate_hit_chance");
        });

        it("should be case-insensitive", () => {
            const results = index.searchWorkspaceSymbols("my_macro");
            expect(results).toHaveLength(1);
            expect(results[0]!.name).toBe("MY_MACRO");
        });

        it("should match anywhere in the name", () => {
            const results = index.searchWorkspaceSymbols("armor");
            expect(results).toHaveLength(2);
            expect(results.map((s) => s.name)).toContain("apply_armor");
            expect(results.map((s) => s.name)).toContain("get_armor_class");
        });

        it("should return empty array when nothing matches", () => {
            const results = index.searchWorkspaceSymbols("nonexistent");
            expect(results).toHaveLength(0);
        });

        it("should cap results at maxResults", () => {
            const results = index.searchWorkspaceSymbols("", 3);
            expect(results).toHaveLength(3);
        });

        it("should return results from multiple files", () => {
            const results = index.searchWorkspaceSymbols("calculate");
            const uris = results.map((s) => s.location.uri);
            expect(uris).toContain(URI_A);
            expect(uris).toContain(URI_B);
        });

        it("should include Navigation, Workspace, and Document symbols", () => {
            index.updateFile(normalizeUri(URI_HEADER), [
                createSymbol("header_func", { sourceType: SourceType.Workspace, uri: URI_HEADER }),
            ]);

            const results = index.searchWorkspaceSymbols("");
            // 5 navigation + 1 workspace
            expect(results).toHaveLength(6);
            expect(results.find((s) => s.name === "header_func")).toBeDefined();
        });

        it("should exclude static symbols", () => {
            index.loadStatic([createSymbol("builtin", { sourceType: SourceType.Static, uri: null })]);

            const results = index.searchWorkspaceSymbols("builtin");
            expect(results).toHaveLength(0);
        });

        it("should return SymbolInformation with correct kind and location", () => {
            const results = index.searchWorkspaceSymbols("MY_MACRO");
            expect(results).toHaveLength(1);

            const sym = results[0];
            expect(sym!.name).toBe("MY_MACRO");
            // Macro maps to Function in VSCode SymbolKind
            expect(sym!.kind).toBe(VscodeSymbolKind.Function);
            expect(sym!.location.uri).toBe(URI_A);
        });

        it("should include displayPath as containerName", () => {
            const customIndex = new Symbols();
            customIndex.updateFile(normalizeUri(URI_A), [createSymbol("my_func", { displayPath: "scripts/a.ssl" })]);

            const results = customIndex.searchWorkspaceSymbols("my_func");
            expect(results).toHaveLength(1);
            expect(results[0]!.containerName).toBe("scripts/a.ssl");
        });

        it("should omit containerName when displayPath is undefined", () => {
            const customIndex = new Symbols();
            customIndex.updateFile(normalizeUri(URI_A), [createSymbol("bare_func")]);

            const results = customIndex.searchWorkspaceSymbols("bare_func");
            expect(results).toHaveLength(1);
            expect(results[0]!.containerName).toBeUndefined();
        });
    });

    // =========================================================================
    // Navigation symbols in lookup (should still be findable)
    // =========================================================================

    describe("lookup() includes Navigation symbols", () => {
        it("should find Navigation symbols by name", () => {
            index.updateFile(normalizeUri(URI_A), [createSymbol("nav_proc", { sourceType: SourceType.Navigation })]);

            const result = index.lookup("nav_proc");
            expect(result).toBeDefined();
            expect(result?.name).toBe("nav_proc");
        });
    });

    // =========================================================================
    // getFileSymbols() returns stored array directly (no wasteful copy)
    // =========================================================================

    describe("getFileSymbols()", () => {
        it("should return the same array reference for the same file", () => {
            index.updateFile(normalizeUri(URI_A), [createSymbol("proc_a")]);

            const first = index.getFileSymbols(normalizeUri(URI_A));
            const second = index.getFileSymbols(normalizeUri(URI_A));
            expect(first).toBe(second);
        });

        it("should return empty array for unknown file", () => {
            const result = index.getFileSymbols(normalizeUri("file:///unknown"));
            expect(result).toEqual([]);
        });
    });

    // =========================================================================
    // clearFile removes Navigation symbols
    // =========================================================================

    describe("clearFile() removes Navigation symbols", () => {
        it("should remove Navigation symbols from search", () => {
            index.updateFile(normalizeUri(URI_A), [createSymbol("proc_a")]);
            index.updateFile(normalizeUri(URI_B), [createSymbol("proc_b", { uri: URI_B })]);

            index.clearFile(normalizeUri(URI_A));

            const results = index.searchWorkspaceSymbols("");
            expect(results).toHaveLength(1);
            expect(results[0]!.name).toBe("proc_b");
        });
    });
});
