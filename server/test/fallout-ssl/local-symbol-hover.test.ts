/**
 * Tests for local symbol hover in Fallout SSL files.
 * Verifies that hover works for symbols defined in the current file
 * without showing redundant file paths, and uses language-tagged code fences.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { MarkupKind } from "vscode-languageserver/node";

// Mock LSP connection before importing modules that use it
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { lookupLocalSymbol, clearAllLocalSymbolsCache } from "../../src/fallout-ssl/local-symbols";
import { initParser } from "../../src/fallout-ssl/parser";

describe("fallout-ssl local symbol hover", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("should NOT include file path in hover for local procedures", () => {
        const text = `
procedure my_proc begin
    display_msg("hello");
end
`;
        const uri = "file:///mymod/scripts/test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_proc", text, 1, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        expect(symbol?.hover?.contents).toHaveProperty("kind", MarkupKind.Markdown);

        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_proc");

        // Should NOT contain file path or bgforge-mls-comment block with path
        expect(value).not.toContain("test.ssl");
        expect(value).not.toContain("mymod");
    });

    it("should NOT include file path in hover for local macros", () => {
        const text = `
#define MY_MACRO(x) (x + 1)
`;
        const uri = "file:///mymod/scripts/test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("MY_MACRO", text, 1, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();
        expect(symbol?.hover?.contents).toHaveProperty("kind", MarkupKind.Markdown);

        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("MY_MACRO");

        // Should NOT contain file path or bgforge-mls-comment block with path
        expect(value).not.toContain("test.ssl");
        expect(value).not.toContain("mymod");
        // Should NOT have an empty bgforge-mls-comment block either
        expect(value).not.toMatch(/bgforge-mls-comment\s*\n\s*\n/);
    });

    it("should NOT include file path in hover for local constant macros", () => {
        const text = `
#define MAX_VALUE 100
`;
        const uri = "file:///mymod/scripts/test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("MAX_VALUE", text, 1, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();

        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // Constant macros show just the value, not "NAME = value"
        expect(value).toContain("100");

        // Should NOT contain file path
        expect(value).not.toContain("test.ssl");
        expect(value).not.toContain("mymod");
    });

    it("should NOT include file path in hover for local variables", () => {
        const text = `
variable my_var := 42;
`;
        const uri = "file:///mymod/scripts/test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_var", text, 1, uri);

        expect(symbol).toBeDefined();
        expect(symbol?.hover).toBeDefined();

        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_var");

        // Should NOT contain file path
        expect(value).not.toContain("test.ssl");
        expect(value).not.toContain("mymod");
    });

    it("should use language-tagged code fence for variable hover", () => {
        const text = `
variable my_var := 42;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_var", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // Should use fallout-ssl-tooltip language tag, not bare ```
        expect(value).toContain("```fallout-ssl-tooltip");
        expect(value).toContain("my_var");
    });

    it("should use language-tagged code fence for procedure hover", () => {
        const text = `
procedure my_proc begin
end
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_proc", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        // Should use fallout-ssl-tooltip language tag
        expect(value).toContain("```fallout-ssl-tooltip");
        expect(value).toContain("my_proc");
    });

    it("should include JSDoc content in procedure hover", () => {
        const text = `
/**
 * Calculates the sum
 * @param int a First number
 * @param int b Second number
 * @return int The sum
 */
procedure add(variable a, variable b) begin
    return a + b;
end
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("add", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("add");
        expect(value).toContain("sum");
    });

    it("should include default parameter values in procedure hover", () => {
        const text = `
procedure test_defaults(variable x = 0, variable y, variable z = 5) begin
end
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("test_defaults", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("x = 0");
        expect(value).toContain("z = 5");
    });

    it("should include export variable description in hover", () => {
        const text = `
export variable my_export := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_export", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_export");
        expect(value).toContain("export variable");
    });

    it("should include export variable description in hover", () => {
        const text = `
export variable my_export := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_export", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_export");
        expect(value).toContain("export variable");
    });

    it("should include JSDoc @type in variable hover", () => {
        const text = `
/** @type int */
variable my_count := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_count", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_count");
        expect(value).toContain("int");
    });

    it("should include export variable description in hover", () => {
        const text = `
export variable my_export := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_export", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_export");
        expect(value).toContain("export variable");
    });

    it("should include JSDoc @type in variable hover", () => {
        const text = `
/** @type int */
variable my_count := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_count", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_count");
        expect(value).toContain("int");
    });

    it("should include JSDoc description in variable hover", () => {
        const text = `
/**
 * Tracks the number of kills.
 * @type int
 */
variable kill_count := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("kill_count", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("kill_count");
        expect(value).toContain("int");
        expect(value).toContain("Tracks the number of kills.");
    });

    it("should include JSDoc description without @type in variable hover", () => {
        const text = `
/** The player's current score. */
variable score := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("score", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("score");
        expect(value).toContain("variable score");
        expect(value).toContain("The player's current score.");
    });

    it("should include JSDoc @type in export variable hover", () => {
        const text = `
/** @type int */
export variable my_export := 0;
`;
        const uri = "file:///test.ssl";
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_export", text, 1, uri);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { kind: string; value: string }).value;
        expect(value).toContain("my_export");
        expect(value).toContain("int");
        expect(value).toContain("export variable");
    });
});
