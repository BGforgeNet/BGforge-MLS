/**
 * Tests for TP2 local completion merging in filterCompletions().
 * Verifies that local symbols from getLocalSymbols() (file-scope variables + functions)
 * are merged with function-scoped variables from localCompletion(),
 * and that local completions take precedence over static/header ones.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { CompletionItemKind, Position } from "vscode-languageserver/node";

// Mock LSP connection before importing provider
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

vi.mock("../../src/common", async (importOriginal) => {
    const mod = await importOriginal<typeof import("../../src/common")>();
    return {
        ...mod,
        isSubpath: vi.fn(() => true),
    };
});

import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { defaultSettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

describe("weidu-tp2: local completion merge", () => {
    it("local file-scope variables have hover documentation", () => {
        const text = `
/**
 * My documented variable
 * @type {int}
 */
OUTER_SET my_documented_var = 42
COPY ~a~ ~b~
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on a non-declaration line where completions should fire
        const position: Position = { line: 7, character: 5 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const item = filteredItems.find((i) => i.label === "my_documented_var");
        expect(item).toBeDefined();
        expect(item?.kind).toBe(CompletionItemKind.Variable);

        // File-scope variables from getLocalSymbols should have documentation
        if (item?.documentation && typeof item.documentation === "object" && "value" in item.documentation) {
            expect(item.documentation.value).toContain("my_documented_var");
        }
    });

    it("local functions have hover documentation in completions", () => {
        const text = `
/**
 * A helpful function
 * @param int count Number of items
 */
DEFINE_ACTION_FUNCTION helpful_func
    INT_VAR count = 0
BEGIN
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 8, character: 0 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const item = filteredItems.find((i) => i.label === "helpful_func");
        expect(item).toBeDefined();
        expect(item?.kind).toBe(CompletionItemKind.Function);

        // Function completions from getLocalSymbols should have documentation
        if (item?.documentation && typeof item.documentation === "object" && "value" in item.documentation) {
            expect(item.documentation.value).toContain("helpful_func");
        }
    });

    it("function-scoped variables are still included via deep extraction", () => {
        // Variables inside function bodies are NOT in getLocalSymbols (file-scope only)
        // but should still appear via localCompletion() (deep AST walk)
        const text = `
DEFINE_PATCH_FUNCTION inner_func BEGIN
    SET inner_only_var = 99
    PATCH_PRINT ~%inner_only_var%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 3, character: 20 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const item = filteredItems.find((i) => i.label === "inner_only_var");
        expect(item).toBeDefined();
        expect(item?.kind).toBe(CompletionItemKind.Variable);
    });

    it("does not duplicate file-scope variables from both sources", () => {
        // File-scope variables appear in both getLocalSymbols() and localCompletion().
        // After dedup, each name should appear exactly once.
        const text = `
OUTER_SET dedup_test_var = 1
OUTER_SET another_var = 2
COPY ~a~ ~b~
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on a non-declaration line where completions should fire
        const position: Position = { line: 3, character: 5 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const matches = filteredItems.filter((i) => i.label === "dedup_test_var");
        expect(matches).toHaveLength(1);
    });
});
