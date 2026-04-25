/**
 * Tests for TP2 document symbol provider.
 * Verifies outline symbols for functions/macros (with body variable children)
 * and file-level variables.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { SymbolKind } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

import { getDocumentSymbols } from "../../src/weidu-tp2/symbol";
import { initParser } from "../../../shared/parsers/weidu-tp2";

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2: getDocumentSymbols", () => {
    it("returns function symbols", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols).toHaveLength(1);
        expect(symbols[0]!.name).toBe("my_func");
        expect(symbols[0]!.kind).toBe(SymbolKind.Function);
    });

    it("returns macro symbols with Method kind", () => {
        const text = `DEFINE_ACTION_MACRO my_macro BEGIN END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols).toHaveLength(1);
        expect(symbols[0]!.name).toBe("my_macro");
        expect(symbols[0]!.kind).toBe(SymbolKind.Method);
    });

    it("returns patch macro symbols with Method kind", () => {
        const text = `DEFINE_PATCH_MACRO my_macro BEGIN END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols[0]!.kind).toBe(SymbolKind.Method);
    });

    it("returns no detail for top-level symbols", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func INT_VAR x = 0 BEGIN END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols[0]!.detail).toBeUndefined();
    });

    it("returns file-level variables from OUTER_SET", () => {
        const text = `OUTER_SET my_var = 42`;
        const symbols = getDocumentSymbols(text);
        const varSym = symbols.find((s) => s.name === "my_var");
        expect(varSym).toBeDefined();
        expect(varSym!.kind).toBe(SymbolKind.Variable);
    });

    it("returns file-level variables from OUTER_SPRINT", () => {
        const text = `OUTER_SPRINT my_str ~hello~`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "my_str")).toBeDefined();
    });

    it("returns file-level array definitions with Array kind", () => {
        const text = `ACTION_DEFINE_ARRAY my_arr BEGIN ~a~ ~b~ END`;
        const symbols = getDocumentSymbols(text);
        const sym = symbols.find((s) => s.name === "my_arr");
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe(SymbolKind.Array);
    });

    it("returns file-level variables from OUTER_SPRINTF", () => {
        const text = `OUTER_SPRINTF my_str ~%d~ 42`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "my_str")).toBeDefined();
    });

    it("returns file-level variables from OUTER_TEXT_SPRINT", () => {
        const text = `OUTER_TEXT_SPRINT my_str ~hello~`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "my_str")).toBeDefined();
    });

    it("returns file-level associative array definitions with Array kind", () => {
        const text = `ACTION_DEFINE_ASSOCIATIVE_ARRAY my_map BEGIN ~k~ => ~v~ END`;
        const symbols = getDocumentSymbols(text);
        const sym = symbols.find((s) => s.name === "my_map");
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe(SymbolKind.Array);
    });

    it("returns Constant kind for UPPER_first_word variables", () => {
        const text = `OUTER_SET MOD_version = 1`;
        const symbols = getDocumentSymbols(text);
        const sym = symbols.find((s) => s.name === "MOD_version");
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe(SymbolKind.Constant);
    });

    it("returns Constant kind for all-uppercase variables", () => {
        const text = `OUTER_SET DEBUG = 1`;
        const symbols = getDocumentSymbols(text);
        const sym = symbols.find((s) => s.name === "DEBUG");
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe(SymbolKind.Constant);
    });

    it("returns Variable kind for lowercase-first variables", () => {
        const text = `OUTER_SET my_var = 1`;
        const symbols = getDocumentSymbols(text);
        const sym = symbols.find((s) => s.name === "my_var");
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe(SymbolKind.Variable);
    });

    it("returns file-level loop vars from ACTION_PHP_EACH", () => {
        const text = `ACTION_PHP_EACH my_arr AS k => v BEGIN END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "k")).toBeDefined();
        expect(symbols.find((s) => s.name === "v")).toBeDefined();
    });

    it("returns file-level loop var from ACTION_FOR_EACH", () => {
        const text = `ACTION_FOR_EACH item IN ~a~ ~b~ ~c~ BEGIN END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "item")).toBeDefined();
    });

    it("returns INT_VAR params as function children", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func INT_VAR x = 0 y = 1 BEGIN END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        expect(func!.children).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("x");
        expect(names).toContain("y");
        for (const child of func!.children!) {
            expect(child.kind).toBe(SymbolKind.Variable);
            expect(child.detail).toBe("my_func");
        }
    });

    it("returns STR_VAR params as function children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func STR_VAR name = ~~ BEGIN END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        expect(func!.children).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("name");
    });

    it("returns params before body vars in children order", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func INT_VAR x = 0 BEGIN
            SET y = 1
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toEqual(["x", "y"]);
    });

    it("preserves source order for multi-line params", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func
  STR_VAR
    item = ~~
    creature = ~~
  BEGIN END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toEqual(["item", "creature"]);
    });

    it("deduplicates params vs body vars (param wins)", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func INT_VAR x = 0 BEGIN
            SET x = 5
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const xChildren = func!.children!.filter((c) => c.name === "x");
        expect(xChildren).toHaveLength(1);
    });

    it("returns function body variables as children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            SET my_var = 5
            SPRINT my_str ~hello~
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        expect(func!.children).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("my_var");
        expect(names).toContain("my_str");
        for (const child of func!.children!) {
            expect(child.kind).toBe(SymbolKind.Variable);
            expect(child.detail).toBe("my_func");
        }
    });

    it("returns READ_BYTE vars as function children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            READ_BYTE 0x00 my_byte
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("my_byte");
    });

    it("returns SPRINTF and TEXT_SPRINT vars as function children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            SPRINTF my_fmt ~%d~ 42
            TEXT_SPRINT my_txt ~hello~
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("my_fmt");
        expect(names).toContain("my_txt");
    });

    it("returns LOCAL_SET vars as macro children", () => {
        const text = `DEFINE_ACTION_MACRO my_macro BEGIN
            LOCAL_SET my_local = 1
        END`;
        const symbols = getDocumentSymbols(text);
        const macro = symbols.find((s) => s.name === "my_macro");
        expect(macro).toBeDefined();
        expect(macro!.children!.map((c) => c.name)).toContain("my_local");
    });

    it("returns READ_LONG and READ_SHORT vars as function children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            READ_LONG 0x00 my_long
            READ_SHORT 0x04 my_short
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("my_long");
        expect(names).toContain("my_short");
    });

    it("returns PHP_EACH loop vars as function children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            PHP_EACH my_arr AS k => v BEGIN END
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("k");
        expect(names).toContain("v");
    });

    it("returns macro body variables as children", () => {
        const text = `DEFINE_ACTION_MACRO my_macro BEGIN
            OUTER_SET my_var = 1
        END`;
        const symbols = getDocumentSymbols(text);
        const macro = symbols.find((s) => s.name === "my_macro");
        expect(macro).toBeDefined();
        expect(macro!.children).toBeDefined();
        expect(macro!.children!.map((c) => c.name)).toContain("my_var");
        expect(macro!.children![0]!.detail).toBe("my_macro");
    });

    it("collects nested vars from inside conditionals as flat children", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            PATCH_IF 1 BEGIN
                SET nested_var = 1
            END
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const names = func!.children!.map((c) => c.name);
        expect(names).toContain("nested_var");
    });

    it("returns vars from inside ACTION_IF as file-level symbols", () => {
        const text = `ACTION_IF 1 BEGIN
            OUTER_SPRINT lang_dir ~foo~
        END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "lang_dir")).toBeDefined();
    });

    it("returns vars from nested conditionals as file-level symbols", () => {
        const text = `ACTION_IF 1 BEGIN
            ACTION_IF 1 BEGIN
                OUTER_SET deep_var = 1
            END
        END`;
        const symbols = getDocumentSymbols(text);
        expect(symbols.find((s) => s.name === "deep_var")).toBeDefined();
    });

    it("does not collect function body vars as file-level symbols", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func BEGIN
            OUTER_SET inner_var = 1
        END`;
        const symbols = getDocumentSymbols(text);
        const fileLevelNames = symbols.filter((s) => s.kind !== SymbolKind.Function).map((s) => s.name);
        expect(fileLevelNames).not.toContain("inner_var");
    });

    it("first occurrence wins across top-level and nested vars", () => {
        const text = `OUTER_SET x = 1
ACTION_IF 1 BEGIN
    OUTER_SET x = 2
END`;
        const symbols = getDocumentSymbols(text);
        const xSymbols = symbols.filter((s) => s.name === "x");
        expect(xSymbols).toHaveLength(1);
    });

    it("deduplicates file-level variables by name (first occurrence wins)", () => {
        const text = `OUTER_SET x = 1
OUTER_SET x = 2
OUTER_SET x = 3`;
        const symbols = getDocumentSymbols(text);
        const xSymbols = symbols.filter((s) => s.name === "x");
        expect(xSymbols).toHaveLength(1);
    });

    it("deduplicates body variables by name (first occurrence wins)", () => {
        const text = `DEFINE_PATCH_FUNCTION my_func BEGIN
            SET x = 1
            SET x = x + 1
            SPRINT y ~hello~
            SPRINT y ~world~
        END`;
        const symbols = getDocumentSymbols(text);
        const func = symbols.find((s) => s.name === "my_func");
        expect(func).toBeDefined();
        const xChildren = func!.children!.filter((c) => c.name === "x");
        const yChildren = func!.children!.filter((c) => c.name === "y");
        expect(xChildren).toHaveLength(1);
        expect(yChildren).toHaveLength(1);
    });

    it("does not produce symbols from broken/error code", () => {
        // Tree-sitter error recovery can wrap garbage text in valid-looking nodes
        // (e.g. "aaaaaaa zzzzzz" becomes a patch_assignment with a phantom "=").
        // Only real variables should appear; hasError guard filters error-recovery artifacts.
        const text = `qqqqqq
ACTION_IF ENGINE_IS ~tob~ BEGIN
  OUTER_SPRINT TOBEX_MOD_DIRECTORY ~%MOD_FOLDER%~
  LOAD_TRA "%TOBEX_MOD_DIRECTORY%/TobEx_redist/TobEx.tra"
wwwwww
  INCLUDE "%TOBEX_MOD_DIRECTORY%/TobEx_redist/TobEx.tpa"

  eeeeee
END
aaaaaaa zzzzzz

ddddddd`;
        const symbols = getDocumentSymbols(text);
        const names = symbols.map((s) => s.name);
        expect(names).toEqual(["TOBEX_MOD_DIRECTORY"]);
    });

    it("returns empty array for empty text", () => {
        expect(getDocumentSymbols("")).toEqual([]);
    });
});
