/**
 * Unit tests for WeiDU TP2 function parameter position-scoped hover.
 * Tests that hover only shows parameter info when cursor is inside a function call.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

// Mock the LSP connection module
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

// Mock isSubpath to always return true
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
import type { HoverResult } from "../../src/language-provider";
import { normalizeUri } from "../../src/core/normalized-uri";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

/** Extract hover contents value from a HoverResult for assertions. */
function hoverValue(result: HoverResult | undefined): string | undefined {
    if (!result || !result.handled || !result.hover) return undefined;
    const contents = result.hover.contents;
    if (typeof contents === "object" && "value" in contents) {
        return contents.value;
    }
    return undefined;
}

describe("weidu-tp2: function parameter hover (position-scoped)", () => {
    it("returns hover info for parameter when cursor is inside function call", () => {
        // Define a function in header file
        const headerText = `
DEFINE_ACTION_FUNCTION unstack_armor_bonus
    INT_VAR
        stacking_id_base = 0
BEGIN
    PRINT ~test~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        // Test hover inside function call - cursor on parameter name
        const text = `OUTER_SET stacking_id_base = 123
LAF unstack_armor_bonus
    INT_VAR
        stacking_id_base = 100
END
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on "stacking_id_base" at line 3 (inside the function call)
        const position: Position = { line: 3, character: 10 };

        const result = weiduTp2Provider.hover?.(text, "stacking_id_base", uri, position);

        expect(result?.handled).toBe(true);
        const value = hoverValue(result);
        expect(value).toContain("int stacking_id_base = 0");
    });

    it("returns not-handled for same-named variable when cursor is outside function call", () => {
        // Define a function in header file
        const headerText = `
DEFINE_ACTION_FUNCTION unstack_armor_bonus
    INT_VAR
        stacking_id_base = 0
BEGIN
    PRINT ~test~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        // Test hover outside function call - cursor on variable declaration
        const text = `OUTER_SET stacking_id_base = 123
LAF unstack_armor_bonus
    INT_VAR
        stacking_id_base = 100
END
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on "stacking_id_base" at line 0 (outside the function call)
        const position: Position = { line: 0, character: 15 };

        const result = weiduTp2Provider.hover?.(text, "stacking_id_base", uri, position);

        // Should NOT show function parameter hover (position is outside function call)
        // Variable not in index, so returns not-handled to fall through to data-driven hover
        expect(result?.handled).toBe(false);
    });

    it("returns hover for parameter in nested function calls based on position", () => {
        const headerText1 = `
DEFINE_ACTION_FUNCTION outer_func
    INT_VAR
        outer_param = 1
BEGIN
END
`;
        const headerText2 = `
DEFINE_PATCH_FUNCTION inner_func
    INT_VAR
        inner_param = 2
BEGIN
END
`;
        const headerUri1 = normalizeUri("file:///lib1.tph");
        const headerUri2 = normalizeUri("file:///lib2.tph");
        weiduTp2Provider.reloadFileData?.(headerUri1, headerText1);
        weiduTp2Provider.reloadFileData?.(headerUri2, headerText2);

        const text = `LAF outer_func
    INT_VAR
        outer_param = 10
END

COPY ~file.bcs~ ~override~
    LPF inner_func
        INT_VAR
            inner_param = 20
    END
`;
        const uri = normalizeUri("file:///test.tp2");

        // Position inside outer_func call
        const positionOuter: Position = { line: 2, character: 10 };
        const resultOuter = weiduTp2Provider.hover?.(text, "outer_param", uri, positionOuter);
        expect(resultOuter?.handled).toBe(true);
        expect(hoverValue(resultOuter)).toContain("int outer_param = 1");

        // Position inside inner_func call
        const positionInner: Position = { line: 8, character: 15 };
        const resultInner = weiduTp2Provider.hover?.(text, "inner_param", uri, positionInner);
        expect(resultInner?.handled).toBe(true);
        expect(hoverValue(resultInner)).toContain("int inner_param = 2");

        // Position between the two function calls (outside both)
        const positionBetween: Position = { line: 4, character: 0 };
        const resultBetween = weiduTp2Provider.hover?.(text, "outer_param", uri, positionBetween);
        // Symbol not in variable index and not in function call, returns not-handled (fall through)
        expect(resultBetween?.handled).toBe(false);
    });

    it("returns hover for STR_VAR parameter when inside function call", () => {
        const headerText = `
DEFINE_ACTION_FUNCTION test_func
    STR_VAR
        message = "default"
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `OUTER_TEXT_SPRINT message ~global~

LAF test_func
    STR_VAR
        message = ~local~
END
`;
        const uri = normalizeUri("file:///test.tp2");

        // Inside function call
        const positionInside: Position = { line: 4, character: 10 };
        const resultInside = weiduTp2Provider.hover?.(text, "message", uri, positionInside);
        expect(resultInside?.handled).toBe(true);
        expect(hoverValue(resultInside)).toContain('string message = "default"');

        // Outside function call (on global variable)
        const positionOutside: Position = { line: 0, character: 22 };
        const resultOutside = weiduTp2Provider.hover?.(text, "message", uri, positionOutside);
        // Variable not in index, returns not-handled (fall through to data-driven hover)
        expect(resultOutside?.handled).toBe(false);
    });

    it("shows JSDoc description in parameter hover when available", () => {
        const headerText = `
/**
 * Test function with documented parameters.
 * @param {int} stacking_id_base - Base ID for stacking groups
 */
DEFINE_PATCH_FUNCTION unstack_armor_bonus
    INT_VAR
        stacking_id_base = 0
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `LPF unstack_armor_bonus
    INT_VAR
        stacking_id_base = 100
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 10 };

        const result = weiduTp2Provider.hover?.(text, "stacking_id_base", uri, position);

        expect(result?.handled).toBe(true);
        const value = hoverValue(result);
        expect(value).toContain("int stacking_id_base = 0");
        expect(value).toContain("Base ID for stacking groups");
    });

    it("hides default value for required parameters in hover", () => {
        const headerText = `
/**
 * Test function with required parameter.
 * @param {int} required_param! - Required parameter (note the ! marker)
 */
DEFINE_ACTION_FUNCTION test_func
    INT_VAR
        required_param = 0
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `LAF test_func
    INT_VAR
        required_param = 42
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 10 };

        const result = weiduTp2Provider.hover?.(text, "required_param", uri, position);

        expect(result?.handled).toBe(true);
        const value = hoverValue(result);
        // Required param should NOT show "= 0" default value
        expect(value).toContain("int required_param");
        expect(value).not.toContain("= 0");
        expect(value).toContain("Required parameter");
    });

    it("hover returns empty (no fallthrough) for param name when function is not indexed", () => {
        const text = `LPF unknown_func
    INT_VAR
        parameter2 = 1
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 10 };

        // hover() should return handled+null (block fallthrough) not not-handled (fall through)
        const result = weiduTp2Provider.hover?.(text, "parameter2", uri, position);
        expect(result?.handled).toBe(true);
        if (result?.handled) {
            expect(result.hover).toBeNull();
        }
    });
});

describe("weidu-tp2: shouldProvideFeatures (comment suppression only)", () => {
    it("returns true for param name (only comments are suppressed)", () => {
        const text = `COPY_EXISTING ~sw1h54.itm~ ~override~
  LPF ADD_SPELL_EFFECT
    INT_VAR
      opcode = OPCODE_play_3d_effect
      parameter2 = 1
  END
BUT_ONLY
`;
        // "parameter2" at line 4, col 10
        const position: Position = { line: 4, character: 10 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);
    });

    it("returns true for variable value inside COPY_EXISTING LPF call", () => {
        const text = `OUTER_SET my_val = 5
COPY_EXISTING ~sw1h54.itm~ ~override~
  LPF ADD_SPELL_EFFECT
    INT_VAR
      parameter2 = my_val
  END
BUT_ONLY
`;
        // "my_val" at line 4, col 18 (the value, not the param name)
        const position: Position = { line: 4, character: 18 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);
    });
    it("returns false inside a block comment", () => {
        const text = `/* some comment */\nOUTER_SET x = 1\n`;
        const position: Position = { line: 0, character: 5 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(false);
    });

    it("returns false inside a JSDoc comment", () => {
        const text = `/** @type int Description */\nOUTER_SET x = 1\n`;
        const position: Position = { line: 0, character: 10 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(false);
    });

    it("returns false inside a line comment", () => {
        const text = `// line comment\nOUTER_SET x = 1\n`;
        const position: Position = { line: 0, character: 5 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(false);
    });

    it("returns true outside comments", () => {
        const text = `OUTER_SET x = 1\n`;
        const position: Position = { line: 0, character: 5 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);
    });

    it("returns true on code after a comment", () => {
        const text = `/* comment */\nOUTER_SET x = 1\n`;
        const position: Position = { line: 1, character: 5 };
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);
    });
});

describe("weidu-tp2: server-flow hover for function call params", () => {
    it("server flow returns function param hover when cursor is on param name of indexed function", () => {
        const headerText = `
DEFINE_ACTION_FUNCTION test_func
    INT_VAR
        func_param = 99
BEGIN
    PRINT ~test~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `LAF test_func
    INT_VAR
        func_param = 1
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const symbol = "func_param";
        const position: Position = { line: 2, character: 10 };

        // Simulate server.ts flow:
        // 1. Gate: shouldProvideFeatures (comments only now)
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);

        // 2. Try local hover (new semantics: handled means provider claims this position)
        const localHover = weiduTp2Provider.hover?.(text, symbol, uri, position);
        expect(localHover?.handled).toBe(true);
        if (localHover?.handled) {
            expect(localHover.hover).not.toBeNull();
            expect(hoverValue(localHover)).toContain("int func_param = 99");
        }
    });

    it("server flow does NOT return variable hover when cursor is on param name of non-indexed function", () => {
        const varFileText = `
OUTER_SET my_var = 123
`;
        const varUri = normalizeUri("file:///vars.tp2");
        weiduTp2Provider.reloadFileData?.(varUri, varFileText);

        const text = `LAF unknown_func
    INT_VAR
        my_var = 1
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const symbol = "my_var";
        const position: Position = { line: 2, character: 10 };

        // 1. Gate passes (not a comment)
        expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);

        // 2. hover() returns handled+null (block fallthrough)
        const localHover = weiduTp2Provider.hover?.(text, symbol, uri, position);
        expect(localHover?.handled).toBe(true);
        if (localHover?.handled) {
            expect(localHover.hover).toBeNull();
        }

        // Since localHover.handled is true, server.ts does NOT call getHover()
        // Variable data never leaks
    });

    it("server flow returns variable hover when cursor is on variable outside function call", () => {
        // Load variable from a .tph header (must be .tph, not .tp2, to be indexed)
        const varFileText = `
OUTER_SET my_var = 456
`;
        const varUri = normalizeUri("file:///vars.tph");
        weiduTp2Provider.reloadFileData?.(varUri, varFileText);

        try {
            const text = `OUTER_SET local_copy = my_var

LAF some_func
    INT_VAR
        param = 1
END
`;
            const uri = normalizeUri("file:///test.tp2");
            const symbol = "my_var";
            const position: Position = { line: 0, character: 25 };

            // 1. Gate passes
            expect(weiduTp2Provider.shouldProvideFeatures?.(text, position)).toBe(true);

            // 2. hover() tries param hover / position suppression
            const localHover = weiduTp2Provider.hover?.(text, symbol, uri, position);
            expect(localHover?.handled).toBe(false);

            // 3. Falls through to resolveSymbol() (the registry path)
            const resolved = weiduTp2Provider.resolveSymbol?.(symbol, text, uri);
            // Variable data should be available from the indexed symbol path
            expect(resolved?.hover).toBeDefined();
        } finally {
            weiduTp2Provider.onWatchedFileDeleted?.(varUri);
        }
    });
});

describe("weidu-tp2: loop variable binding hover suppression", () => {
    it("returns empty for variable in PHP_EACH AS binding", () => {
        // Index a variable named 'opcode' from a header
        const headerText = `OUTER_SET opcode = 999\n`;
        weiduTp2Provider.reloadFileData?.(normalizeUri("file:///lib.tph"), headerText);

        const text = `COPY_EXISTING ~sw1h54.itm~ ~override~
  PHP_EACH save_opcodes AS opcode => int BEGIN
    PATCH_PRINT ~%opcode%~
  END
BUT_ONLY
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on 'opcode' after AS (not inside 'save_opcodes')
        const line1 = text.split("\n")[1];
        const col = line1!.indexOf("AS opcode") + 3; // skip "AS "
        const position: Position = { line: 1, character: col };

        const result = weiduTp2Provider.hover?.(text, "opcode", uri, position);
        // Should return handled+null — loop binding, not a reference
        expect(result?.handled).toBe(true);
        if (result?.handled) {
            expect(result.hover).toBeNull();
        }
    });

    it("returns empty for variable in ACTION_PHP_EACH AS binding", () => {
        const headerText = `OUTER_SET item = 0\n`;
        weiduTp2Provider.reloadFileData?.(normalizeUri("file:///lib.tph"), headerText);

        const text = `ACTION_PHP_EACH my_array AS item => power BEGIN
  PRINT ~%item%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const line0 = text.split("\n")[0];
        const col = line0!.indexOf("AS item") + 3; // skip "AS "
        const position: Position = { line: 0, character: col };

        const result = weiduTp2Provider.hover?.(text, "item", uri, position);
        expect(result?.handled).toBe(true);
        if (result?.handled) {
            expect(result.hover).toBeNull();
        }
    });

    it("returns empty for value variable in PHP_EACH => binding", () => {
        const headerText = `OUTER_SET power = 0\n`;
        weiduTp2Provider.reloadFileData?.(normalizeUri("file:///lib.tph"), headerText);

        const text = `ACTION_PHP_EACH my_array AS item => power BEGIN
  PRINT ~%power%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on 'power' after '=>'
        const line0 = text.split("\n")[0];
        const col = line0!.indexOf("=> power") + 3; // skip "=> "
        const position: Position = { line: 0, character: col };

        const result = weiduTp2Provider.hover?.(text, "power", uri, position);
        expect(result?.handled).toBe(true);
        if (result?.handled) {
            expect(result.hover).toBeNull();
        }
    });

    it("allows hover for variable reference inside loop body", () => {
        const headerText = `OUTER_SET opcode = 999\n`;
        weiduTp2Provider.reloadFileData?.(normalizeUri("file:///lib.tph"), headerText);

        const text = `COPY_EXISTING ~sw1h54.itm~ ~override~
  PHP_EACH save_opcodes AS item => int BEGIN
    SET x = opcode
  END
BUT_ONLY
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on 'opcode' in SET x = opcode (line 2)
        const line2 = text.split("\n")[2];
        const col = line2!.indexOf("opcode");
        const position: Position = { line: 2, character: col };

        const result = weiduTp2Provider.hover?.(text, "opcode", uri, position);
        // Should NOT be handled+null — this is a reference, not a binding
        // It should either return found hover or not-handled (fall through)
        if (result?.handled) {
            expect(result.hover).not.toBeNull();
        }
    });
});
