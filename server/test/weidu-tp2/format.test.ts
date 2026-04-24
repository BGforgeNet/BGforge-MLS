/**
 * Unit tests for WeiDU TP2 formatter.
 * Tests utility functions and formatting integration.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { MarkupContent } from "vscode-languageserver/node";

/** Extract markdown value from hover contents. */
function getHoverValue(contents: unknown): string {
    return (contents as MarkupContent).value;
}

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import {
    normalizeLineComment,
    normalizeBlockComment,
    normalizeComment,
    normalizeWhitespace,
    withNormalizedComment,
    isAction,
    isPatch,
    isControlFlow,
    isCopyAction,
    isFunctionDef,
    isFunctionCall,
    isBodyContent,
} from "../../src/weidu-tp2/format/utils";
import { formatDocument } from "../../src/weidu-tp2/format/core";
import { initParser, getParser } from "../../src/weidu-tp2/parser";
import { parseFile } from "../../src/weidu-tp2/header-parser";

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import type { IndexedSymbol } from "../../src/core/symbol";

describe("format-utils: normalizeLineComment", () => {
    it("adds space after // if missing", () => {
        expect(normalizeLineComment("//comment")).toBe("// comment");
    });

    it("preserves existing space after //", () => {
        expect(normalizeLineComment("// comment")).toBe("// comment");
    });

    it("preserves multiple spaces after //", () => {
        expect(normalizeLineComment("//  indented")).toBe("//  indented");
    });

    it("handles empty comment", () => {
        expect(normalizeLineComment("//")).toBe("//");
    });

    it("handles tab after //", () => {
        expect(normalizeLineComment("//\tindented")).toBe("//\tindented");
    });

    it("trims leading whitespace", () => {
        expect(normalizeLineComment("  // comment")).toBe("// comment");
    });
});

describe("format-utils: normalizeBlockComment", () => {
    it("trims whitespace", () => {
        expect(normalizeBlockComment("  /* comment */  ")).toBe("/* comment */");
    });

    it("preserves internal formatting", () => {
        expect(normalizeBlockComment("/* line1\n   line2 */")).toBe("/* line1\n   line2 */");
    });
});

describe("format-utils: normalizeComment", () => {
    it("normalizes line comments", () => {
        expect(normalizeComment("//comment")).toBe("// comment");
    });

    it("normalizes block comments", () => {
        expect(normalizeComment("  /* test */  ")).toBe("/* test */");
    });
});

describe("format-utils: normalizeWhitespace", () => {
    it("collapses multiple spaces", () => {
        expect(normalizeWhitespace("hello    world")).toBe("hello world");
    });

    it("preserves line comments", () => {
        expect(normalizeWhitespace("code // comment")).toBe("code // comment");
    });

    it("handles multiline with comments", () => {
        expect(normalizeWhitespace("line1\ncode // comment")).toBe("line1\ncode // comment");
    });

    it("trims lines", () => {
        expect(normalizeWhitespace("  hello  ")).toBe("hello");
    });
});

describe("format-utils: withNormalizedComment", () => {
    it("returns line as-is without comment", () => {
        expect(withNormalizedComment("hello world")).toBe("hello world");
    });

    it("normalizes inline comment spacing", () => {
        expect(withNormalizedComment("code//comment")).toBe("code  // comment");
    });

    it("handles standalone comment", () => {
        expect(withNormalizedComment("  //comment")).toBe("  // comment");
    });

    it("handles empty comment", () => {
        expect(withNormalizedComment("code  //")).toBe("code  //");
    });
});

describe("format-utils: type predicates", () => {
    it("isAction detects action types", () => {
        expect(isAction("action_copy")).toBe(true);
        expect(isAction("action_assignment")).toBe(true);
        expect(isAction("action_fail")).toBe(true);
        expect(isAction("identifier")).toBe(false);
    });

    it("isPatch detects patch types", () => {
        expect(isPatch("patch_write_byte")).toBe(true);
        expect(isPatch("read_var")).toBe(true);
        expect(isPatch("set_var")).toBe(true);
        expect(isPatch("action")).toBe(false);
    });

    it("isControlFlow detects control flow types", () => {
        expect(isControlFlow("action_if")).toBe(true);
        expect(isControlFlow("patch_match")).toBe(true);
        expect(isControlFlow("outer_for")).toBe(true);
        expect(isControlFlow("action_copy")).toBe(false);
    });

    it("isCopyAction detects copy action types", () => {
        expect(isCopyAction("action_copy")).toBe(true);
        expect(isCopyAction("action_copy_existing")).toBe(true);
        // inner_action has its own formatter, not a copy action
        expect(isCopyAction("inner_action")).toBe(false);
        expect(isCopyAction("action_if")).toBe(false);
    });

    it("isFunctionDef detects function definition types", () => {
        expect(isFunctionDef("action_define_function")).toBe(true);
        expect(isFunctionDef("action_define_patch_macro")).toBe(true);
        expect(isFunctionDef("action_launch_function")).toBe(false);
    });

    it("isFunctionCall detects function call types", () => {
        expect(isFunctionCall("action_launch_function")).toBe(true);
        expect(isFunctionCall("patch_launch_macro")).toBe(true);
        expect(isFunctionCall("action_define_function")).toBe(false);
    });

    it("isBodyContent detects valid body content", () => {
        expect(isBodyContent("action_copy")).toBe(true);
        expect(isBodyContent("patch_write_byte")).toBe(true);
        expect(isBodyContent("action_if")).toBe(true);
        expect(isBodyContent("string")).toBe(false);
    });
});

describe("formatDocument integration", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        const result = formatDocument(tree.rootNode);
        return result.text;
    }

    it("formats simple BACKUP directive", () => {
        const input = "BACKUP   ~weidu_external/backup/mymod~";
        const output = format(input);
        expect(output).toBe("BACKUP ~weidu_external/backup/mymod~\n");
    });

    it("formats simple component", () => {
        const input = "BEGIN @1";
        const output = format(input);
        expect(output).toBe("BEGIN @1\n");
    });

    it("formats component with action", () => {
        const input = `BEGIN @1
COPY ~src~ ~dst~`;
        const output = format(input);
        expect(output).toContain("BEGIN @1");
        expect(output).toContain("COPY ~src~ ~dst~");
    });

    it("normalizes whitespace in directives", () => {
        const input = "BACKUP     ~path/to/backup~";
        const output = format(input);
        expect(output).toBe("BACKUP ~path/to/backup~\n");
    });

    it("preserves comments", () => {
        const input = `// This is a comment
BEGIN @1`;
        const output = format(input);
        expect(output).toContain("// This is a comment");
        expect(output).toContain("BEGIN @1");
    });

    it("adds space after // in comments", () => {
        const input = `//comment without space
BEGIN @1`;
        const output = format(input);
        expect(output).toContain("// comment without space");
    });

    it("preserves intentional comment indentation", () => {
        const input = `//     indented content
BEGIN @1`;
        const output = format(input);
        expect(output).toContain("//     indented content");
    });

    it("formats ALWAYS block", () => {
        const input = `ALWAYS
OUTER_SET foo = 1
END`;
        const output = format(input);
        expect(output).toContain("ALWAYS");
        expect(output).toContain("    OUTER_SET foo = 1");
        expect(output).toContain("END");
    });

    it("formats ACTION_IF with condition", () => {
        const input = `BEGIN @1
ACTION_IF foo BEGIN
PRINT ~test~
END`;
        const output = format(input);
        expect(output).toContain("ACTION_IF foo BEGIN");
        expect(output).toContain("    PRINT ~test~");
        expect(output).toContain("END");
    });

    it("formats function definition", () => {
        const input = `DEFINE_ACTION_FUNCTION test
BEGIN
PRINT ~hello~
END`;
        const output = format(input);
        expect(output).toContain("DEFINE_ACTION_FUNCTION test");
        expect(output).toContain("BEGIN");
        expect(output).toContain("    PRINT ~hello~");
        expect(output).toContain("END");
    });

    it("formats function call with INT_VAR", () => {
        const input = `BEGIN @1
LAF test
INT_VAR
foo = 1
bar = 2
END`;
        const output = format(input);
        expect(output).toContain("LAF test");
        expect(output).toContain("INT_VAR");
        expect(output).toMatch(/foo\s+=\s+1/);
        expect(output).toMatch(/bar\s+=\s+2/);
    });

    it("aligns INT_VAR assignments", () => {
        const input = `BEGIN @1
LAF test
INT_VAR
x = 1
longname = 2
END`;
        const output = format(input);
        // Both assignments should have same alignment
        const lines = output.split("\n");
        const xLine = lines.find((l) => l.includes("x "));
        const longnameLine = lines.find((l) => l.includes("longname"));
        if (xLine && longnameLine) {
            const xEqPos = xLine.indexOf("=");
            const longEqPos = longnameLine.indexOf("=");
            expect(xEqPos).toBe(longEqPos);
        }
    });

    it("handles inline comments", () => {
        const input = `BEGIN @1  // component comment`;
        const output = format(input);
        expect(output).toContain("BEGIN @1  // component comment");
    });

    it("preserves inline comments on INT_VAR assignments", () => {
        const input = `BEGIN @1
LAF test
INT_VAR
projectile = 191  // ice scorcher
target = 4  // area
END`;
        const output = format(input);
        // Comments should stay inline with their assignments
        expect(output).toMatch(/projectile\s+=\s+191\s+\/\/ ice scorcher/);
        expect(output).toMatch(/target\s+=\s+4\s+\/\/ area/);
    });

    it("preserves inline comments in nested function calls", () => {
        const input = `BEGIN @1
COPY_EXISTING ~item.itm~ ~override~
  PATCH_IF foo = 0 BEGIN
    LPF ALTER_ITEM
      INT_VAR
        value = 100  // important value
    END
  END`;
        const output = format(input);
        expect(output).toMatch(/value\s+=\s+100\s+\/\/ important value/);
    });

    it("preserves multi-line JSDoc comments before function definition", () => {
        const input = `/**
 * test123
 * @arg {int} bonus nvli23yr4gbpy324b li2u.hj1bo81264g108y4vb120834612vo4y1jvt189ftvgt1
 */
DEFINE_PATCH_FUNCTION unstack_armor_bonus
  INT_VAR bonus = 0 stacking_id_base = 0
BEGIN
  PATCH_PRINT ~test~
END`;
        const output = format(input);

        // Should preserve the multi-line structure
        expect(output).toContain("/**");
        expect(output).toContain(" * test123");
        expect(output).toContain(" * @arg {int} bonus");
        expect(output).toContain(" */");

        // Should NOT flatten to a single line
        expect(output).not.toContain("/** * test123 * @arg");
    });
});

describe("formatDocument TRY blocks", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        const result = formatDocument(tree.rootNode);
        return result.text;
    }

    it("formats PATCH_TRY with body", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
PATCH_TRY
READ_ASCII 0 sig (4)
WITH DEFAULT
PATCH_WARN ~error~
END`;
        const output = format(input);
        expect(output).toContain("PATCH_TRY");
        expect(output).toContain("READ_ASCII 0 sig (4)");
        expect(output).toContain("WITH DEFAULT");
        expect(output).toContain("PATCH_WARN ~error~");
    });

    it("formats PATCH_TRY with INNER_PATCH_FILE", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.2da~ ~override~
PATCH_TRY
INNER_PATCH_FILE ~item.itm~ BEGIN
READ_STRREF 0 name
END
WITH DEFAULT
PATCH_WARN ~error~
END`;
        const output = format(input);
        expect(output).toContain("PATCH_TRY");
        expect(output).toContain("INNER_PATCH_FILE ~item.itm~ BEGIN");
        expect(output).toContain("READ_STRREF 0 name");
        expect(output).toContain("WITH DEFAULT");
    });

    it("formats INNER_PATCH buffer variant", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
INNER_PATCH ~some_buffer~ BEGIN
SET value = 100
END`;
        const output = format(input);
        expect(output).toContain("INNER_PATCH ~some_buffer~ BEGIN");
        expect(output).toContain("SET value = 100");
        expect(output).toContain("END");
    });

    it("formats INNER_PATCH_SAVE variant", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
INNER_PATCH_SAVE result ~input_buffer~ BEGIN
REPLACE_TEXTUALLY ~old~ ~new~
END`;
        const output = format(input);
        expect(output).toContain("INNER_PATCH_SAVE result ~input_buffer~ BEGIN");
        expect(output).toContain("REPLACE_TEXTUALLY ~old~ ~new~");
        expect(output).toContain("END");
    });

    it("formats nested INNER_PATCH variants", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
INNER_PATCH_FILE ~outer.itm~ BEGIN
INNER_PATCH_SAVE modified ~buffer~ BEGIN
SET x = 1
END
END`;
        const output = format(input);
        expect(output).toContain("INNER_PATCH_FILE ~outer.itm~ BEGIN");
        expect(output).toContain("INNER_PATCH_SAVE modified ~buffer~ BEGIN");
        expect(output).toContain("SET x = 1");
    });

    it("formats ACTION_TRY", () => {
        const input = `BEGIN @1
ACTION_TRY
COPY ~src~ ~dst~
WITH DEFAULT
WARN ~error~
END`;
        const output = format(input);
        expect(output).toContain("ACTION_TRY");
        expect(output).toContain("COPY ~src~ ~dst~");
        expect(output).toContain("WITH DEFAULT");
        expect(output).toContain("WARN ~error~");
    });

    it("preserves comments in PATCH_TRY", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
PATCH_TRY
// Try to read
READ_ASCII 0 sig (4)
WITH DEFAULT
// Handle error
PATCH_WARN ~error~
END`;
        const output = format(input);
        expect(output).toContain("// Try to read");
        expect(output).toContain("// Handle error");
    });

    it("indents PATCH_TRY body content", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
PATCH_TRY
READ_ASCII 0 sig (4)
WITH DEFAULT
PATCH_WARN ~error~
END`;
        const output = format(input);
        const lines = output.split("\n");
        const readLine = lines.find((l) => l.includes("READ_ASCII"));
        const warnLine = lines.find((l) => l.includes("PATCH_WARN"));
        // Component body at depth=0, COPY body at depth=1, PATCH_TRY body at depth=2
        expect(readLine).toMatch(/^\s{8}READ_ASCII/);
        expect(warnLine).toMatch(/^\s{8}PATCH_WARN/);
    });
});

describe("formatDocument MATCH statements", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        const result = formatDocument(tree.rootNode);
        return result.text;
    }

    it("formats PATCH_MATCH with cases", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
PATCH_MATCH type
WITH 1 BEGIN
SET foo = 1
END
WITH 2 BEGIN
SET foo = 2
END
DEFAULT
SET foo = 0
END`;
        const output = format(input);
        expect(output).toContain("PATCH_MATCH type");
        expect(output).toContain("WITH");
        expect(output).toContain("1 BEGIN");
        expect(output).toContain("SET foo = 1");
        expect(output).toContain("DEFAULT");
    });

    it("formats ACTION_MATCH", () => {
        const input = `BEGIN @1
ACTION_MATCH %var%
WITH 1 BEGIN
PRINT ~one~
END
DEFAULT
PRINT ~default~
END`;
        const output = format(input);
        expect(output).toContain("ACTION_MATCH %var%");
        expect(output).toContain("WITH");
        expect(output).toContain("1 BEGIN");
        expect(output).toContain("PRINT ~one~");
        expect(output).toContain("DEFAULT");
    });

    it("preserves comments in MATCH cases", () => {
        const input = `BEGIN @1
COPY_EXISTING ~test.itm~ ~override~
PATCH_MATCH type
// First case
WITH 1 BEGIN
SET foo = 1
END
DEFAULT
SET foo = 0
END`;
        const output = format(input);
        expect(output).toContain("// First case");
    });
});

describe("formatDocument throws on structural errors", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        return formatDocument(tree.rootNode).text;
    }

    it("succeeds for valid code", () => {
        const input = `BACKUP ~backup~\nBEGIN @1\nCOPY ~src~ ~dst~`;
        expect(() => format(input)).not.toThrow();
    });

    it("returns text for valid code", () => {
        const input = `BEGIN @1\nCOPY ~src~ ~dst~`;
        const result = format(input);
        expect(result).toContain("BEGIN @1");
        expect(result).toContain("COPY");
    });
});

describe("header-parser: parseHeader", () => {
    // Lazy-load module after parser initialization
    let parseHeader: typeof import("../../src/weidu-tp2/header-parser").parseHeader;

    beforeAll(async () => {
        await initParser();
        const mod = await import("../../src/weidu-tp2/header-parser");
        parseHeader = mod.parseHeader;
    });

    it("extracts function definitions", () => {
        const code = `DEFINE_ACTION_FUNCTION my_function BEGIN END`;
        const functions = parseHeader(code, "file:///test.tph");
        expect(functions).toHaveLength(1);
        expect(functions[0].name).toBe("my_function");
        expect(functions[0].context).toBe("action");
        expect(functions[0].dtype).toBe("function");
    });

    it("extracts macro definitions", () => {
        const code = `DEFINE_PATCH_MACRO my_macro BEGIN END`;
        const functions = parseHeader(code, "file:///test.tph");
        expect(functions).toHaveLength(1);
        expect(functions[0].name).toBe("my_macro");
        expect(functions[0].context).toBe("patch");
        expect(functions[0].dtype).toBe("macro");
    });

    it("extracts function parameters", () => {
        const code = `DEFINE_ACTION_FUNCTION test_func
INT_VAR
    foo = 1
    bar = 2
STR_VAR
    name = ~~
RET
    result
BEGIN
END`;
        const functions = parseHeader(code, "file:///test.tph");
        expect(functions).toHaveLength(1);
        const params = functions[0].params;
        expect(params).toBeDefined();
        expect(params?.intVar).toHaveLength(2);
        expect(params?.strVar).toHaveLength(1);
        expect(params?.ret).toHaveLength(1);
    });

    it("extracts JSDoc comments", () => {
        const code = `/**
 * This is a test function.
 * @param {int} foo - A parameter
 */
DEFINE_ACTION_FUNCTION documented_func BEGIN END`;
        const functions = parseHeader(code, "file:///test.tph");
        expect(functions).toHaveLength(1);
        expect(functions[0].jsdoc).toBeDefined();
        expect(functions[0].jsdoc?.desc).toContain("test function");
    });

    it("handles multiple functions", () => {
        const code = `
DEFINE_ACTION_FUNCTION func1 BEGIN END
DEFINE_PATCH_FUNCTION func2 BEGIN END
DEFINE_ACTION_MACRO macro1 BEGIN END
`;
        const functions = parseHeader(code, "file:///test.tph");
        expect(functions).toHaveLength(3);
        expect(functions.map((f) => f.name)).toEqual(["func1", "func2", "macro1"]);
    });
});

describe("definition: getDefinition", () => {
    // Lazy-load modules after parser initialization
    let getDefinition: typeof import("../../src/weidu-tp2/definition").getDefinition;
    let lazyParseHeaderToSymbols: (...args: Parameters<typeof parseFile>) => IndexedSymbol[];
    let SymbolsClass: typeof import("../../src/core/symbol-index").Symbols;

    beforeAll(async () => {
        await initParser();
        const defMod = await import("../../src/weidu-tp2/definition");
        const headerMod = await import("../../src/weidu-tp2/header-parser");
        const symbolMod = await import("../../src/core/symbol-index");
        getDefinition = defMod.getDefinition;
        lazyParseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...headerMod.parseFile(...args).symbols];
        SymbolsClass = symbolMod.Symbols;
    });

    it("finds same-file function definition", () => {
        const code = `
DEFINE_ACTION_FUNCTION my_func BEGIN END

BEGIN @1
    LAF my_func END
`;
        // Position on "my_func" in the LAF call (line 4, roughly character 8)
        const mockStore = new SymbolsClass();
        const result = getDefinition(code, "file:///test.tp2", { line: 4, character: 8 }, mockStore);
        expect(result).toBeDefined();
        expect(result?.uri).toBe("file:///test.tp2");
        expect(result?.range.start.line).toBe(1); // Definition is on line 1
    });

    it("finds cross-file function definition", () => {
        // Index a header file in Symbols
        const mockStore = new SymbolsClass();
        const headerCode = `DEFINE_ACTION_FUNCTION header_func BEGIN END`;
        const parsedSymbols = lazyParseHeaderToSymbols("file:///header.tph", headerCode);
        mockStore.updateFile("file:///header.tph", parsedSymbols);

        // Main file calls the function
        const mainCode = `
BEGIN @1
    LAF header_func END
`;
        const result = getDefinition(mainCode, "file:///main.tp2", { line: 2, character: 8 }, mockStore);
        expect(result).toBeDefined();
        expect(result?.uri).toBe("file:///header.tph");
    });

    it("returns null for unknown function", () => {
        const code = `
BEGIN @1
    LAF unknown_func END
`;
        const mockStore = new SymbolsClass();
        const result = getDefinition(code, "file:///test.tp2", { line: 2, character: 8 }, mockStore);
        expect(result).toBeNull();
    });
});

describe("hover formatting: parseHeaderToSymbols", () => {
    beforeAll(async () => {
        await initParser();
    });

    /** Look up a symbol by name from parseHeaderToSymbols output. */
    function findSymbol(symbols: IndexedSymbol[], name: string) {
        return symbols.find((s) => s.name === name);
    }

    // Use "/" as workspace root so that URI "file:///lib/test.tph" resolves to display path "lib/test.tph"
    const workspaceRoot = "/";

    it("generates hover with function signature", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(sym).toBeDefined();
        expect(getHoverValue(sym?.hover.contents)).toContain("action function my_func");
    });

    it("generates hover with file path", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///lib/test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(getHoverValue(sym?.hover.contents)).toContain("lib/test.tph");
    });

    it("generates hover with JSDoc description", () => {
        const code = `/**
 * Does something useful.
 */
DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(getHoverValue(sym?.hover.contents)).toContain("Does something useful.");
    });

    it("generates hover with INT_VAR parameters", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func
INT_VAR count = 0
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        const value = getHoverValue(sym?.hover.contents);
        expect(value).toContain("|**INT**|**vars**|");
        expect(value).toContain("count");
        expect(value).toContain("0");
    });

    it("generates hover with STR_VAR parameters", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func
STR_VAR name = ~~
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        const value = getHoverValue(sym?.hover.contents);
        expect(value).toContain("|**STR**|**vars**|");
        expect(value).toContain("name");
    });

    it("generates hover with RET parameters", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func
RET result
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        const value = getHoverValue(sym?.hover.contents);
        expect(value).toContain("|**RET**|**vars**|");
        expect(value).toContain("result");
    });

    it("generates hover with type links for known types", () => {
        const code = `/**
 * @param {int} count
 */
DEFINE_ACTION_FUNCTION my_func
INT_VAR count = 0
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(getHoverValue(sym?.hover.contents)).toContain("[int](https://ielib.bgforge.net/types#int)");
    });

    it("generates hover with default type int for INT_VAR", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func
INT_VAR count = 0
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        // Default type is int, which should be linked
        expect(getHoverValue(sym?.hover.contents)).toContain("[int]");
    });

    it("generates hover with default type string for STR_VAR", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func
STR_VAR name = ~~
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        // Default type is string, which should be linked
        expect(getHoverValue(sym?.hover.contents)).toContain("[string]");
    });

    it("hides Returns when @return has no description", () => {
        const code = `/**
 * @return {int}
 */
DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(getHoverValue(sym?.hover.contents)).not.toContain("Returns");
    });

    it("generates hover with @deprecated notice", () => {
        const code = `/**
 * @deprecated Use new_func instead
 */
DEFINE_ACTION_FUNCTION old_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "old_func");
        const value = getHoverValue(sym?.hover.contents);
        expect(value).toContain("Deprecated");
        expect(value).toContain("Use new_func instead");
    });

    it("truncates long descriptions to 80 chars", () => {
        const longDesc = "A".repeat(100);
        const code = `/**
 * @param {int} count - ${longDesc}
 */
DEFINE_ACTION_FUNCTION my_func
INT_VAR count = 0
BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        const value = getHoverValue(sym?.hover.contents);
        // Should be truncated with ...
        expect(value).toContain("...");
        // Should not contain the full 100 chars
        expect(value).not.toContain(longDesc);
    });

    it("generates completion item", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(sym).toBeDefined();
        expect(sym?.completion.label).toBe("my_func");
    });

    it("generates definition location", () => {
        const code = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
        const symbols = parseHeaderToSymbols("file:///test.tph", code, workspaceRoot);
        const sym = findSymbol(symbols, "my_func");
        expect(sym?.location).toBeDefined();
        expect(sym?.location?.uri).toBe("file:///test.tph");
    });
});

describe("formatDocument component flags", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        const result = formatDocument(tree.rootNode);
        return result.text;
    }

    it("puts each component flag on its own line", () => {
        const input = `BEGIN @1
SUBCOMPONENT @2
REQUIRE_PREDICATE ENGINE_IS ~tob~ @3`;
        const output = format(input);
        const lines = output.split("\n");
        expect(lines[0]).toBe("BEGIN @1");
        expect(lines[1]).toBe("SUBCOMPONENT @2");
        expect(lines[2]).toContain("REQUIRE_PREDICATE");
    });

    it("does not collapse flags onto BEGIN line", () => {
        const input = `BEGIN @1 SUBCOMPONENT @2 LABEL ~my_label~`;
        const output = format(input);
        const lines = output.split("\n");
        expect(lines[0]).toBe("BEGIN @1");
        expect(lines[1]).toBe("SUBCOMPONENT @2");
        expect(lines[2]).toBe("LABEL ~my_label~");
    });

    it("preserves inline comment on flag line", () => {
        const input = `BEGIN @1
SUBCOMPONENT @2  // group name`;
        const output = format(input);
        expect(output).toContain("SUBCOMPONENT @2  // group name");
    });

    it("splits long REQUIRE_PREDICATE at OR boundary", () => {
        const input = `BEGIN @1
REQUIRE_PREDICATE ( MOD_IS_INSTALLED ~tnt.tp2~ (ID_OF_LABEL ~tnt.tp2~ ~g_tnt_traps_intuition_no_combat~) OR MOD_IS_INSTALLED ~tnt.tp2~ (ID_OF_LABEL ~tnt.tp2~ ~g_tnt_traps_intuition_combat~) ) @304`;
        const output = format(input);
        const lines = output.split("\n");
        // Should split across lines
        const predLine = lines.find((l) => l.includes("REQUIRE_PREDICATE"));
        expect(predLine).toBeDefined();
        expect(predLine!.length).toBeLessThanOrEqual(120);
        // OR should be on continuation line
        const orLine = lines.find((l) => l.trimStart().startsWith("OR "));
        expect(orLine).toBeDefined();
    });

    it("splits long REQUIRE_PREDICATE with NOT prefix", () => {
        const input = `BEGIN @1
REQUIRE_PREDICATE NOT ( MOD_IS_INSTALLED ~ua.tp2~ (ID_OF_LABEL ~ua.tp2~ ~g_ua_core_strict~) OR MOD_IS_INSTALLED ~ua.tp2~ (ID_OF_LABEL ~ua.tp2~ ~g_ua_core_expanded~) ) @32`;
        const output = format(input);
        // NOT prefix should be preserved
        expect(output).toContain("REQUIRE_PREDICATE NOT (");
        // Should split at OR
        const lines = output.split("\n");
        const orLine = lines.find((l) => l.trimStart().startsWith("OR "));
        expect(orLine).toBeDefined();
    });

    it("keeps short REQUIRE_PREDICATE on one line", () => {
        const input = `BEGIN @1
REQUIRE_PREDICATE ENGINE_IS ~tob~ @3`;
        const output = format(input);
        expect(output).toContain("REQUIRE_PREDICATE ENGINE_IS ~tob~ @3");
    });
});

describe("formatDocument COPY inline comments", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        const result = formatDocument(tree.rootNode);
        return result.text;
    }

    it("keeps inline comment on its file pair in multi-file COPY", () => {
        const input = `BEGIN @1
COPY_EXISTING
  ~file1.spl~ ~override~  // first file
  ~file2.spl~ ~override~
  SET foo = 1`;
        const output = format(input);
        expect(output).toContain("~file1.spl~ ~override~  // first file");
        expect(output).not.toMatch(/~file2.spl~.*\/\/ first file/);
    });

    it("keeps inline comment on second file pair", () => {
        const input = `BEGIN @1
COPY_EXISTING
  ~file1.spl~ ~override~
  ~file2.spl~ ~override~  // second file
  SET foo = 1`;
        const output = format(input);
        expect(output).toContain("~file2.spl~ ~override~  // second file");
        expect(output).not.toMatch(/~file1.spl~.*\/\/ second file/);
    });
});

describe("formatDocument multi-line OR conditions", () => {
    beforeAll(async () => {
        await initParser();
    });

    function format(code: string): string {
        const parser = getParser();
        const tree = parser.parse(code);
        const result = formatDocument(tree.rootNode);
        return result.text;
    }

    it("splits multi-line OR conditions that exceed line limit", () => {
        const input = `PATCH_IF (c == kensai_column) BEGIN
  PATCH_IF (r0 == $row_index(BASTARDSWORD))
    OR (r0 == $row_index(LONGSWORD))
    OR (r0 == $row_index(SHORTSWORD))
    OR (r0 == $row_index(TWOHANDEDSWORD))
    OR (r0 == $row_index(KATANA))
    OR (r0 == $row_index(SCIMITARWAKISASHININJATO))
  BEGIN
    pip_limit = 5
  END
END`;
        const output = format(input);

        // Should NOT collapse into single long line
        expect(output).not.toMatch(/PATCH_IF.*OR.*OR.*OR.*OR.*OR.*BEGIN/);

        // Each OR should be on separate lines when line exceeds limit (120 chars)
        const lines = output.split("\n");
        const allLinesFit = lines.every((line) => line.length <= 120);
        expect(allLinesFit).toBe(true);

        // Should have multiple OR lines
        const orLines = lines.filter((l) => l.includes(" OR "));
        expect(orLines.length).toBeGreaterThan(1);
    });
});
