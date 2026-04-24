/**
 * Unit tests for fallout-ssl document symbol provider.
 * Covers the empty-name guard: tree-sitter can produce nodes with empty text
 * for incomplete/malformed input, which would crash VSCode's symbol API
 * ("name must not be falsy").
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { SymbolKind } from "vscode-languageserver/node";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDocumentSymbols } from "../../src/fallout-ssl/symbol";
import { initParser } from "../../src/fallout-ssl/parser";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl: getDocumentSymbols", () => {
    it("returns procedure symbols", () => {
        const text = `procedure my_proc begin end`;
        const symbols = getDocumentSymbols(text);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe("my_proc");
        expect(symbols[0].kind).toBe(SymbolKind.Function);
    });

    it("returns variable symbols", () => {
        const text = `variable my_var := 0;`;
        const symbols = getDocumentSymbols(text);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe("my_var");
        expect(symbols[0].kind).toBe(SymbolKind.Variable);
    });

    it("returns export variable symbols", () => {
        const text = `export variable exported_var;`;
        const symbols = getDocumentSymbols(text);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe("exported_var");
        expect(symbols[0].kind).toBe(SymbolKind.Variable);
    });

    it("returns multiple symbols", () => {
        const text = `
variable x := 1;
variable y := 2;
procedure foo begin end
procedure bar begin end
`;
        const symbols = getDocumentSymbols(text);
        const names = symbols.map((s) => s.name);
        expect(names).toContain("x");
        expect(names).toContain("y");
        expect(names).toContain("foo");
        expect(names).toContain("bar");
    });

    it("never returns symbols with empty names", () => {
        // Incomplete/malformed input that tree-sitter may parse with empty name nodes.
        // The guard in makeSymbol should filter these out instead of crashing.
        const malformed = [
            `procedure`,
            `procedure ;`,
            `variable`,
            `variable ;`,
            `export variable`,
            `export variable ;`,
        ];
        for (const text of malformed) {
            const symbols = getDocumentSymbols(text);
            for (const sym of symbols) {
                expect(sym.name, `Got empty name for input: "${text}"`).toBeTruthy();
            }
        }
    });

    it("returns procedure symbols without detail", () => {
        const text = `procedure my_proc(variable x, variable y) begin end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        expect(proc!.detail).toBeUndefined();
    });

    it("returns procedure params as children with parent detail", () => {
        const text = `procedure my_proc(variable x, variable y) begin end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        expect(proc!.children).toBeDefined();
        const children = proc!.children!;
        const names = children.map((c) => c.name);
        expect(names).toContain("x");
        expect(names).toContain("y");
        for (const child of children) {
            expect(child.kind).toBe(SymbolKind.Variable);
            expect(child.detail).toBe("my_proc");
        }
    });

    it("returns local variables as procedure children", () => {
        const text = `procedure my_proc begin
            variable local_var := 0;
        end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        const children = proc!.children!;
        expect(children.map((c) => c.name)).toContain("local_var");
        expect(children.find((c) => c.name === "local_var")!.detail).toBe("my_proc");
    });

    it("returns for loop declaration vars as procedure children", () => {
        const text = `procedure my_proc begin
            for (variable i = 0; i < 10; i++) begin
            end
        end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        const names = proc!.children!.map((c) => c.name);
        expect(names).toContain("i");
    });

    it("does not produce children for for loops without declarations", () => {
        const text = `procedure my_proc begin
            for (i := 0; i < 10; i++) begin
            end
        end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        expect(proc!.children).toBeUndefined();
    });

    it("does not produce children for foreach loop variables", () => {
        const text = `procedure my_proc begin
            foreach (k: v in arr) begin
            end
        end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        expect(proc!.children).toBeUndefined();
    });

    it("collects nested vars from inside conditionals as flat children", () => {
        const text = `procedure my_proc begin
            if (true) then begin
                variable nested_var := 1;
            end
        end`;
        const symbols = getDocumentSymbols(text);
        const proc = symbols.find((s) => s.name === "my_proc");
        expect(proc).toBeDefined();
        const names = proc!.children!.map((c) => c.name);
        expect(names).toContain("nested_var");
    });

    it("returns empty array for empty text", () => {
        expect(getDocumentSymbols("")).toEqual([]);
    });

    it("returns macro symbols for #define constants", () => {
        const text = `#define MAX_ITEMS 100`;
        const symbols = getDocumentSymbols(text);
        // Macros are returned as Constant symbols
        const macro = symbols.find((s) => s.name === "MAX_ITEMS");
        expect(macro).toBeDefined();
        expect(macro!.kind).toBe(SymbolKind.Constant);
    });

    it("returns macro symbols for parameterized #define (Method kind)", () => {
        const text = `#define CLAMP(x, min, max) (x < min ? min : (x > max ? max : x))`;
        const symbols = getDocumentSymbols(text);
        const macro = symbols.find((s) => s.name === "CLAMP");
        expect(macro).toBeDefined();
        expect(macro!.kind).toBe(SymbolKind.Method);
    });

    it("returns macro and procedure symbols together", () => {
        const text = `
#define SPEED 3
procedure run begin end
`;
        const symbols = getDocumentSymbols(text);
        const names = symbols.map((s) => s.name);
        expect(names).toContain("SPEED");
        expect(names).toContain("run");
    });
});
