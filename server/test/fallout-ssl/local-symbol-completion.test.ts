/**
 * Tests for local symbol completion in Fallout SSL files.
 * Verifies that lookupLocalSymbol().completion has proper documentation
 * for procedures, macros, and variables.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver/node";

// Mock LSP connection before importing modules that use it
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
}));

import { lookupLocalSymbol, getLocalSymbols, clearAllLocalSymbolsCache } from "../../src/fallout-ssl/local-symbols";
import { initParser } from "../../src/fallout-ssl/parser";
import { isVariableSymbol } from "../../src/core/symbol";

describe("fallout-ssl local symbol completion", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("should produce Function completion for procedures", () => {
        const text = `
procedure my_proc(variable x) begin
end
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_proc", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.completion.label).toBe("my_proc");
        expect(symbol?.completion.kind).toBe(CompletionItemKind.Function);
    });

    it("should include markdown documentation in procedure completion", () => {
        const text = `
/**
 * Does something useful
 * @param int x Input value
 */
procedure my_proc(variable x) begin
end
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_proc", text, uri);

        expect(symbol).toBeDefined();
        const docs = symbol?.completion.documentation;
        expect(docs).toBeDefined();
        expect(docs).toHaveProperty("kind", MarkupKind.Markdown);

        const value = (docs as { kind: string; value: string }).value;
        expect(value).toContain("my_proc");
        expect(value).toContain("something useful");
    });

    it("should produce Variable completion for variables", () => {
        const text = `
variable my_var := 42;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_var", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.completion.label).toBe("my_var");
        expect(symbol?.completion.kind).toBe(CompletionItemKind.Variable);
    });

    it("should produce Variable completion for export variables", () => {
        const text = `
export variable my_export := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_export", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.completion.label).toBe("my_export");
        expect(symbol?.completion.kind).toBe(CompletionItemKind.Variable);
    });

    it("should include macros in local symbols", () => {
        const text = `
#define MY_CONST 100
#define MY_FUNC(x) (x + 1)
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();

        const constSymbol = lookupLocalSymbol("MY_CONST", text, uri);
        expect(constSymbol).toBeDefined();
        expect(constSymbol?.completion.label).toBe("MY_CONST");

        const funcSymbol = lookupLocalSymbol("MY_FUNC", text, uri);
        expect(funcSymbol).toBeDefined();
        expect(funcSymbol?.completion.label).toBe("MY_FUNC");
    });

    it("should not set type on variable symbols when type is unknown", () => {
        const text = `
variable my_var := 42;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_var", text, uri);

        expect(symbol).toBeDefined();
        expect(isVariableSymbol(symbol!)).toBe(true);
        if (isVariableSymbol(symbol!)) {
            // Type should be omitted when not known, not set to magic "unknown" string
            expect(symbol.variable.type).toBeUndefined();
        }
    });

    it("should not have explicit signature on variable symbols", () => {
        const text = `
variable my_var := 42;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_var", text, uri);

        expect(symbol).toBeDefined();
        // signature should not be present (not even as undefined key)
        expect("signature" in symbol!).toBe(false);
    });

    it("should return all local symbols from getLocalSymbols", () => {
        const text = `
variable my_var := 0;
procedure my_proc begin end
#define MY_CONST 42
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();

        const symbols = getLocalSymbols(text, uri);
        const names = symbols.map((s) => s.name);

        expect(names).toContain("my_var");
        expect(names).toContain("my_proc");
        expect(names).toContain("MY_CONST");
    });
});
