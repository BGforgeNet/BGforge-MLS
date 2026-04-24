/**
 * Unit tests for TP2 declaration-site completion suppression.
 * Verifies that completions are suppressed or filtered when the cursor is on a new
 * symbol name being declared.
 *
 * Declaration site types:
 * - "assignment": SET/SPRINT variable name — local variable completions allowed
 * - "definition": function/macro/array/loop name — all completions suppressed
 * - false: not a declaration site — normal completions
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { isAtDeclarationSite, type DeclarationSiteResult } from "../../src/weidu-tp2/completion/context";
import { CompletionItemKind, type Position } from "vscode-languageserver/node";
import * as path from "path";

// Mock LSP connection before importing provider
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn() },
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
import { initParser } from "../../src/weidu-tp2/parser";
import { defaultSettings } from "../../src/settings";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

/** Helper: builds single-line text and tests at end of line. */
function expectSite(line: string, expected: DeclarationSiteResult) {
    expect(isAtDeclarationSite(line, { line: 0, character: line.length })).toBe(expected);
}

describe("TP2 declaration-site detection", () => {
    describe("variable assignments return 'assignment'", () => {
        it("detects OUTER_SET with partial name", () => {
            expectSite("OUTER_SET my_v", "assignment");
        });

        it("detects OUTER_SET with no name yet", () => {
            expectSite("OUTER_SET ", "assignment");
        });

        it("detects SET with partial name", () => {
            expectSite("  SET foo", "assignment");
        });

        it("detects SPRINT with partial name", () => {
            expectSite("SPRINT my_str", "assignment");
        });

        it("detects OUTER_SPRINT with partial name", () => {
            expectSite("OUTER_SPRINT var", "assignment");
        });

        it("detects TEXT_SPRINT with partial name", () => {
            expectSite("TEXT_SPRINT t", "assignment");
        });

        it("detects OUTER_TEXT_SPRINT with partial name", () => {
            expectSite("OUTER_TEXT_SPRINT t", "assignment");
        });

        it("is case-insensitive", () => {
            expectSite("outer_set MY_VAR", "assignment");
            expectSite("Outer_Sprint x", "assignment");
        });
    });

    describe("variable assignments with modifiers return 'assignment'", () => {
        it("detects OUTER_SET EVAL with partial name", () => {
            expectSite("OUTER_SET EVAL my_v", "assignment");
        });

        it("detects SET EVALUATE_BUFFER with partial name", () => {
            expectSite("SET EVALUATE_BUFFER var", "assignment");
        });

        it("detects SPRINT GLOBAL with partial name", () => {
            expectSite("SPRINT GLOBAL gs", "assignment");
        });

        it("detects OUTER_SPRINT EVAL with partial name", () => {
            expectSite("OUTER_SPRINT EVAL s", "assignment");
        });
    });

    describe("function/macro definitions return 'definition'", () => {
        it("detects DEFINE_ACTION_FUNCTION", () => {
            expectSite("DEFINE_ACTION_FUNCTION my_func", "definition");
        });

        it("detects DEFINE_PATCH_FUNCTION", () => {
            expectSite("DEFINE_PATCH_FUNCTION pf", "definition");
        });

        it("detects DEFINE_ACTION_MACRO", () => {
            expectSite("DEFINE_ACTION_MACRO am", "definition");
        });

        it("detects DEFINE_PATCH_MACRO", () => {
            expectSite("DEFINE_PATCH_MACRO pm", "definition");
        });

        it("is case-insensitive for definitions", () => {
            expectSite("define_action_function f", "definition");
        });
    });

    describe("array definitions return 'definition'", () => {
        it("detects DEFINE_ARRAY", () => {
            expectSite("DEFINE_ARRAY arr", "definition");
        });

        it("detects ACTION_DEFINE_ARRAY", () => {
            expectSite("ACTION_DEFINE_ARRAY arr", "definition");
        });

        it("detects DEFINE_ASSOCIATIVE_ARRAY", () => {
            expectSite("DEFINE_ASSOCIATIVE_ARRAY aa", "definition");
        });

        it("detects ACTION_DEFINE_ASSOCIATIVE_ARRAY", () => {
            expectSite("ACTION_DEFINE_ASSOCIATIVE_ARRAY aa", "definition");
        });
    });

    describe("loop variable bindings return 'definition'", () => {
        it("detects FOR_EACH", () => {
            expectSite("FOR_EACH item", "definition");
        });

        it("detects PHP_EACH", () => {
            expectSite("PHP_EACH entry", "definition");
        });

        it("detects PATCH_FOR_EACH", () => {
            expectSite("PATCH_FOR_EACH x", "definition");
        });

        it("detects ACTION_FOR_EACH", () => {
            expectSite("ACTION_FOR_EACH y", "definition");
        });

        it("detects ACTION_PHP_EACH", () => {
            expectSite("ACTION_PHP_EACH e", "definition");
        });

        it("detects PATCH_PHP_EACH", () => {
            expectSite("PATCH_PHP_EACH e", "definition");
        });
    });

    describe("non-declaration positions return false", () => {
        it("does not match after = sign (value position)", () => {
            expectSite("OUTER_SET x = val", false);
        });

        it("does not match SET with value after =", () => {
            expectSite("SET foo = 1", false);
        });

        it("does not match function body after definition", () => {
            expectSite("DEFINE_ACTION_FUNCTION foo INT_VAR bar = ", false);
        });

        it("does not match regular action keywords", () => {
            expectSite("COPY ~file~ ~dest~", false);
        });

        it("does not match LAF/LPF (function calls, not declarations)", () => {
            expectSite("LAF my_func", false);
        });

        it("does not match empty line", () => {
            expectSite("", false);
        });

        it("does not match comment lines", () => {
            expectSite("// OUTER_SET foo", false);
        });
    });

    describe("multiline text with line/character positioning", () => {
        it("detects assignment on second line", () => {
            const text = "COPY ~a~ ~b~\nOUTER_SET my_v";
            expect(isAtDeclarationSite(text, { line: 1, character: 18 })).toBe("assignment");
        });

        it("does not match first line when assignment is on second", () => {
            const text = "COPY ~a~ ~b~\nOUTER_SET my_v";
            expect(isAtDeclarationSite(text, { line: 0, character: 12 })).toBe(false);
        });

        it("returns false for out-of-range line", () => {
            expect(isAtDeclarationSite("OUTER_SET x", { line: 5, character: 0 })).toBe(false);
        });

        it("uses character offset to trim line", () => {
            const text = "OUTER_SET x = 5";
            // Cursor at position 11 => "OUTER_SET x" — assignment site
            expect(isAtDeclarationSite(text, { line: 0, character: 11 })).toBe("assignment");
            // Past the = sign — not a declaration site
            expect(isAtDeclarationSite(text, { line: 0, character: 15 })).toBe(false);
        });
    });
});

describe("TP2 filterCompletions at assignment sites", () => {
    it("returns local variable completions at SET position", () => {
        const text = `
OUTER_SET existing_var = 42
SET ex
`;
        const uri = "file:///test.tp2";
        const position: Position = { line: 2, character: 6 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filtered = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const localVar = filtered.find((i) => i.label === "existing_var");
        expect(localVar).toBeDefined();
        expect(localVar?.kind).toBe(CompletionItemKind.Variable);
    });

    it("excludes static symbols (engine functions) at SET position", () => {
        const text = `
OUTER_SET existing_var = 42
SET ex
`;
        const uri = "file:///test.tp2";
        const position: Position = { line: 2, character: 6 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filtered = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Static items (from YAML data) should NOT appear
        const hasStaticAction = filtered.some((i) => i.label === "COPY");
        const hasStaticPatch = filtered.some((i) => i.label === "WRITE_BYTE");
        expect(hasStaticAction).toBe(false);
        expect(hasStaticPatch).toBe(false);
    });

    it("returns local variable completions at OUTER_SPRINT position", () => {
        const text = `
OUTER_TEXT_SPRINT base_path ~mymod~
OUTER_SPRINT ba
`;
        const uri = "file:///test.tp2";
        const position: Position = { line: 2, character: 15 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filtered = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const localVar = filtered.find((i) => i.label === "base_path");
        expect(localVar).toBeDefined();
    });

    it("returns empty at DEFINE_ACTION_FUNCTION position", () => {
        const text = `
OUTER_SET existing_var = 42
DEFINE_ACTION_FUNCTION my
`;
        const uri = "file:///test.tp2";
        const position: Position = { line: 2, character: 25 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filtered = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        expect(filtered).toEqual([]);
    });

    it("returns only variables, not functions, at SET position", () => {
        const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
OUTER_SET my_var = 1
SET m
`;
        const uri = "file:///test.tp2";
        const position: Position = { line: 3, character: 5 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filtered = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Local variables should be present
        const varItem = filtered.find((i) => i.label === "my_var");
        expect(varItem).toBeDefined();

        // Local functions should NOT be present (you don't assign a function name)
        const funcItem = filtered.find((i) => i.label === "my_func");
        expect(funcItem).toBeUndefined();
    });

    it("excludes the word being typed (no self-referencing completion)", () => {
        const text = `
OUTER_SET existing_var = 42
OUTER_SET existing_v
`;
        const uri = "file:///test.tp2";
        const position: Position = { line: 2, character: 20 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filtered = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // The word being typed ("existing_v") should NOT appear in completions
        const selfRef = filtered.find((i) => i.label === "existing_v");
        expect(selfRef).toBeUndefined();

        // But previously declared variables should still appear
        const existing = filtered.find((i) => i.label === "existing_var");
        expect(existing).toBeDefined();
    });
});
