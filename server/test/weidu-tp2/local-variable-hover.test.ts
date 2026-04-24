/**
 * Tests for local variable hover in WeiDU TP2 files.
 * Verifies that hover works for variables defined in the current file,
 * not just for indexed header files.
 *
 * Uses unified symbol resolution (Approach C) via lookupLocalSymbol.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { MarkupKind } from "vscode-languageserver/node";

// Mock LSP connection before importing modules that use it
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { lookupLocalSymbol, clearAllLocalSymbolsCache } from "../../src/weidu-tp2/local-symbols";
import { initParser } from "../../src/weidu-tp2/parser";

describe("local variable hover", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("should return hover for variable with JSDoc @type", () => {
        const text = `
/** @type {int} Maximum pip count limit */
OUTER_SET pip_limit = 10

LAF my_function END
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("pip_limit", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        expect(symbol?.hover?.contents).toHaveProperty("kind", MarkupKind.Markdown);
        expect(symbol?.hover?.contents).toHaveProperty("value");

        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("pip_limit");
        // Non-UPPERCASE variables should NOT show value
        expect(value).not.toContain("= 10");
    });

    it("should return hover for variable without JSDoc", () => {
        const text = `
OUTER_SET my_var = 42
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_var", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        expect(symbol?.hover?.contents).toHaveProperty("kind", MarkupKind.Markdown);

        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_var");
        // Non-UPPERCASE variables should NOT show value
        expect(value).not.toContain("= 42");
    });

    it("should return hover for string variable (OUTER_SPRINT)", () => {
        const text = `
/** Description of the string */
OUTER_SPRINT my_string ~hello world~
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_string", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_string");
        // Non-UPPERCASE variables should NOT show value
        expect(value).not.toContain("hello world");
    });

    it("should return undefined for non-existent variable", () => {
        const text = `
OUTER_SET foo = 1
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("bar", text, uri);

        expect(symbol).toBeUndefined();
    });

    it("should include JSDoc description in hover", () => {
        const text = `
/**
 * @type {int}
 * This is the detailed description of the variable
 */
OUTER_SET documented_var = 100
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("documented_var", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("documented_var");
        expect(value).toContain("detailed description");
    });

    it("should work with OUTER_TEXT_SPRINT", () => {
        const text = `
OUTER_TEXT_SPRINT text_var ~some text~
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("text_var", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("text_var");
    });

    it("should return first definition when variable is defined multiple times", () => {
        const text = `
/** First definition */
OUTER_SET count = 1

// Later reassignment
OUTER_SET count = 2
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("count", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // Non-UPPERCASE variables should NOT show value
        expect(value).not.toContain("= 1");
        expect(value).toContain("First definition");
    });

    it("should show value for UPPERCASE constant variables", () => {
        const text = `
OUTER_SET MAX_LEVEL = 40
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("MAX_LEVEL", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // UPPERCASE constants SHOULD show value
        expect(value).toContain("int MAX_LEVEL = 40");
    });

    it("should show value for UPPER_case constant variables", () => {
        const text = `
OUTER_TEXT_SPRINT MOD_FOLDER ~mymod~
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("MOD_FOLDER", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // First word uppercase → constant, SHOULD show value
        expect(value).toContain("MOD_FOLDER = ~mymod~");
    });

    it("should show value when first word is uppercase (mixed case rest)", () => {
        const text = `
OUTER_TEXT_SPRINT MOD_folder ~mymod~
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("MOD_folder", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // First word "MOD" is uppercase → constant, SHOULD show value
        expect(value).toContain("MOD_folder = ~mymod~");
    });

    it("should NOT show value when first word is mixed case", () => {
        const text = `
OUTER_SET Max_Level = 40
`;
        const uri = "file:///test.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("Max_Level", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // First word "Max" is mixed case → NOT constant
        expect(value).not.toContain("= 40");
    });

    it("should NOT include file path in hover for local symbols", () => {
        // Local symbols (current file) should not show path - it's redundant
        const text = `
OUTER_SET local_var = 123
`;
        const uri = "file:///mymod/setup.tp2";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("local_var", text, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;

        // Should contain the variable info
        expect(value).toContain("local_var");
        // Non-UPPERCASE variables should NOT show value
        expect(value).not.toContain("= 123");

        // Should NOT contain file path or bgforge-mls-comment block with path
        expect(value).not.toContain("setup.tp2");
        expect(value).not.toContain("mymod");
    });
});
