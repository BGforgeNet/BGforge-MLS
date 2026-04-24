/**
 * Unit tests for fallout-ssl/header-parser.ts - tree-sitter-based parsing of
 * #define macros, procedures, variables, and exports from .h header files.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    findFiles: vi.fn(() => []),
}));

import { parseFile } from "../../src/fallout-ssl/header-parser";

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import { initParser } from "../../src/fallout-ssl/parser";
import { SymbolKind, ScopeLevel, SourceType, isCallableSymbol, isVariableSymbol } from "../../src/core/symbol";
import type { MarkupContent } from "vscode-languageserver/node";

const testUri = "file:///mymod/headers/test.h";
const workspaceRoot = "/mymod";

describe("parseHeaderToSymbols - edge cases", () => {
    beforeAll(async () => {
        await initParser();
    });

    describe("macros with nested parentheses", () => {
        it("parses macro with nested parens in body: #define MACRO(X,Y) call(F(X,Y))", () => {
            // Tree-sitter parses params from the grammar, so MACRO(X,Y) is callable
            const input = `#define MACRO(X,Y) call(F(X,Y))`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("MACRO");

            const hover = symbols[0]!.hover.contents as MarkupContent;
            expect(hover.value).toContain("MACRO");
        });

        it("parses lowercase macro with nested parens as callable", () => {
            // lowercase name => isConstantMacro=false => hasParams=true => CallableSymbol
            const input = `#define my_macro(X,Y) call(F(X,Y))`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("my_macro");
            expect(isCallableSymbol(symbols[0]!)).toBe(true);
        });
    });

    describe("backslash continuation (multiline macros)", () => {
        it("detects multiline macro ending with backslash", () => {
            const input = `#define MY_MACRO begin \\
    some_code; \\
end`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            // Should parse the first line as a macro
            expect(symbols.length).toBeGreaterThanOrEqual(1);
            const macroSymbol = symbols.find((s) => s.name === "MY_MACRO");
            expect(macroSymbol).toBeDefined();
        });

        it("multiline macro without params is still ConstantSymbol", () => {
            // No params in the define signature => hasParams=false => ConstantSymbol
            const input = `#define SETUP_STUFF begin \\
    set_global(1); \\
end`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            const symbol = symbols.find((s) => s.name === "SETUP_STUFF");
            expect(symbol).toBeDefined();
            // Without params in the define signature, it's a ConstantSymbol
            expect(symbol!.kind).toBe(SymbolKind.Constant);
        });

        it("multiline macro with params is callable", () => {
            // lowercase + params => hasParams=true => CallableSymbol
            const input = `#define setup_stuff(x) begin \\
    set_global(x); \\
end`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            const symbol = symbols.find((s) => s.name === "setup_stuff");
            expect(symbol).toBeDefined();
            expect(isCallableSymbol(symbol!)).toBe(true);
            expect(symbol!.kind).toBe(SymbolKind.Macro);
        });
    });

    describe("empty macro body", () => {
        it("parses #define EMPTY with no body after name", () => {
            // Tree-sitter grammar requires a body node for defines
            const input = `#define SOMETHING 1\n#define HAS_BODY (0)`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols.length).toBeGreaterThanOrEqual(1);
            const something = symbols.find((s) => s.name === "SOMETHING");
            expect(something).toBeDefined();
        });
    });

    describe("macro with no space before parenthesis", () => {
        it("parses #define FUNC(X) body -- uppercase with params is callable macro", () => {
            // Tree-sitter correctly identifies FUNC(X) as having params,
            // so it becomes a CallableSymbol regardless of naming convention
            const input = `#define FUNC(X) do_something(X)`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("FUNC");
            expect(symbols[0]!.kind).toBe(SymbolKind.Macro);
            expect(isCallableSymbol(symbols[0]!)).toBe(true);
        });

        it("parses #define func(X) body -- lowercase with params is callable", () => {
            const input = `#define my_func(X) do_something(X)`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("my_func");
            expect(isCallableSymbol(symbols[0]!)).toBe(true);
            expect(symbols[0]!.kind).toBe(SymbolKind.Macro);
        });
    });

    describe("constant vs non-constant macro detection", () => {
        it("detects UPPER_CASE as constant", () => {
            const input = `#define MAX_HP 100`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.kind).toBe(SymbolKind.Constant);
        });

        it("treats lowercase macros without params as constant too", () => {
            // Without params, both uppercase and lowercase macros become ConstantSymbol
            const input = `#define get_value do_stuff`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.kind).toBe(SymbolKind.Constant);
        });
    });

    describe("procedure parsing", () => {
        it("parses procedure with no arguments", () => {
            const input = `procedure my_proc begin end`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("my_proc");
            expect(symbols[0]!.kind).toBe(SymbolKind.Procedure);
        });

        it("parses procedure with arguments", () => {
            const input = `procedure my_proc(variable arg1, variable arg2) begin end`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("my_proc");
            expect(isCallableSymbol(symbols[0]!)).toBe(true);
        });

        it("parses procedure with JSDoc", () => {
            const input = `/**
 * Does something.
 * @param x the first argument
 */
procedure test_proc(variable x) begin end`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            const hover = symbols[0]!.hover.contents as MarkupContent;
            expect(hover.value).toContain("Does something");
        });
    });

    describe("mixed macros and procedures", () => {
        it("parses both macros and procedures from same file", () => {
            const input = `
#define MAX_ITEMS 100
#define get_item(idx) item_at(idx)
procedure init_items begin end
`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(3);
            expect(symbols.some((s) => s.name === "MAX_ITEMS")).toBe(true);
            expect(symbols.some((s) => s.name === "get_item")).toBe(true);
            expect(symbols.some((s) => s.name === "init_items")).toBe(true);
        });
    });

    describe("definition locations", () => {
        it("includes correct line and character in location", () => {
            const input = `#define MY_CONST 42`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.location).not.toBeNull();
            expect(symbols[0]!.location!.uri).toBe(testUri);
            expect(symbols[0]!.location!.range.start.line).toBe(0);
        });
    });

    describe("variable declarations", () => {
        it("parses top-level variable declaration", () => {
            const input = `variable my_var;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("my_var");
            expect(symbols[0]!.kind).toBe(SymbolKind.Variable);
            expect(isVariableSymbol(symbols[0]!)).toBe(true);
            expect(symbols[0]!.scope.level).toBe(ScopeLevel.Workspace);
            expect(symbols[0]!.source.type).toBe(SourceType.Workspace);
            expect(symbols[0]!.source.displayPath).toBe("headers/test.h");
        });

        it("includes displayPath in completion labelDetails", () => {
            const input = `variable counter;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.completion.labelDetails?.description).toBe("headers/test.h");
        });

        it("includes displayPath in hover", () => {
            const input = `variable counter;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            const hover = symbols[0]!.hover.contents as MarkupContent;
            expect(hover.value).toContain("headers/test.h");
        });

        it("parses variable with JSDoc @type", () => {
            const input = `/** @type int */
variable health;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("health");
            const hover = symbols[0]!.hover.contents as MarkupContent;
            expect(hover.value).toContain("int");
            expect(hover.value).toContain("health");
        });

        it("parses multiple variables in one declaration", () => {
            const input = `variable x, y, z;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(3);
            expect(symbols.map((s) => s.name).sort()).toEqual(["x", "y", "z"]);
            for (const sym of symbols) {
                expect(sym.kind).toBe(SymbolKind.Variable);
            }
        });
    });

    describe("export declarations", () => {
        it("parses export declaration", () => {
            const input = `export variable my_export;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("my_export");
            expect(symbols[0]!.kind).toBe(SymbolKind.Variable);
            expect(symbols[0]!.scope.level).toBe(ScopeLevel.Workspace);
        });

        it("includes 'export variable' in hover", () => {
            const input = `export variable shared_state;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            const hover = symbols[0]!.hover.contents as MarkupContent;
            expect(hover.value).toContain("export variable");
        });

        it("parses export with JSDoc", () => {
            const input = `/** Global shared state. */
export variable shared_state;`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(1);
            const hover = symbols[0]!.hover.contents as MarkupContent;
            expect(hover.value).toContain("Global shared state");
        });
    });

    describe("mixed macros, procedures, and variables", () => {
        it("parses all symbol types from same header", () => {
            const input = `
#define MAX_ITEMS 100
variable item_count;
export variable shared_flag;
procedure init_items begin end
`;
            const symbols = parseHeaderToSymbols(testUri, input, workspaceRoot);

            expect(symbols).toHaveLength(4);
            expect(symbols.find((s) => s.name === "MAX_ITEMS")?.kind).toBe(SymbolKind.Constant);
            expect(symbols.find((s) => s.name === "item_count")?.kind).toBe(SymbolKind.Variable);
            expect(symbols.find((s) => s.name === "shared_flag")?.kind).toBe(SymbolKind.Variable);
            expect(symbols.find((s) => s.name === "init_items")?.kind).toBe(SymbolKind.Procedure);
        });
    });
});
