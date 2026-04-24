/**
 * Integration tests for snippet insertion in completion flow.
 * Verifies that filterCompletions produces correct snippets for
 * keyword completions (SET/SPRINT) and function calls (LPF).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { CompletionItemKind, InsertTextFormat, MarkupKind, type CompletionItem } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

import { initParser } from "../../src/weidu-tp2/parser";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import type { Symbols } from "../../src/core/symbol-index";
import { defaultSettings } from "../../src/settings";
import { CompletionCategory, type CompletionItemWithCategory } from "../../src/shared/completion-context";
import { ScopeLevel, SourceType, SymbolKind, type ConstantSymbol } from "../../src/core/symbol";
import * as path from "path";

const HEADER_URI = "file:///test-snippet.tph";
const STATIC_URI = "file:///test-static-keywords.tph";
const CURRENT_URI = "file:///test-mod.tp2";

/**
 * Create a minimal keyword symbol to simulate static data.
 * Static YAML completion data is not available in the test environment
 * (JSON files live in server/out/, not on the source path).
 */
function createKeywordSymbol(name: string, category: CompletionCategory): ConstantSymbol {
    return {
        name,
        kind: SymbolKind.Constant,
        location: null,
        scope: { level: ScopeLevel.Global },
        source: { type: SourceType.Static, uri: null },
        completion: {
            label: name,
            kind: CompletionItemKind.Keyword,
            category,
        } as CompletionItemWithCategory,
        hover: { contents: { kind: MarkupKind.Markdown, value: name } },
        constant: { value: name },
    };
}

/** Filter completions for the given text/position and find an item by label. */
function findCompletion(text: string, line: number, character: number, label: string): CompletionItem | undefined {
    const completions = weiduTp2Provider.getCompletions!(CURRENT_URI);
    const filtered = weiduTp2Provider.filterCompletions!(completions, text, { line, character }, CURRENT_URI);
    return filtered.find((c) => c.label === label);
}

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });

    const headerContent = `
DEFINE_PATCH_FUNCTION func_with_params
    INT_VAR opcode = 206
    STR_VAR resource = ~~
BEGIN
    WRITE_BYTE 0x00 0
END

DEFINE_PATCH_FUNCTION func_no_params
BEGIN
    WRITE_BYTE 0x00 0
END

/**
 * @arg {int} count! required int
 * @arg {string} name! required string
 */
DEFINE_PATCH_FUNCTION func_required_params
    INT_VAR count = 0
    STR_VAR name = ~~
BEGIN
    WRITE_BYTE 0x00 0
END

DEFINE_PATCH_FUNCTION func_with_ret
    STR_VAR resource = ~~
    RET success
    RET_ARRAY items
BEGIN
    WRITE_BYTE 0x00 0
END

DEFINE_PATCH_MACRO my_patch_macro
BEGIN
    WRITE_BYTE 0x00 0
END
`;
    weiduTp2Provider.reloadFileData!(HEADER_URI, headerContent);

    // Inject keyword symbols that normally come from static data (unavailable in test env).
    // Static JSON lives in server/out/ which isn't on the source path during tests,
    // so we access the private fileIndex.symbols directly to inject test-only keyword data.
    const store = (weiduTp2Provider as unknown as { fileIndex: { symbols: Symbols } }).fileIndex.symbols;
    store.updateFile(STATIC_URI, [
        createKeywordSymbol("SET", CompletionCategory.Patch),
        createKeywordSymbol("SPRINT", CompletionCategory.Patch),
        createKeywordSymbol("TEXT_SPRINT", CompletionCategory.Patch),
        createKeywordSymbol("WRITE_BYTE", CompletionCategory.Patch),
        createKeywordSymbol("OUTER_SET", CompletionCategory.Action),
        createKeywordSymbol("OUTER_SPRINT", CompletionCategory.Action),
        createKeywordSymbol("OUTER_TEXT_SPRINT", CompletionCategory.Action),
    ]);
});

// Patch context: BEGIN + existing patch content needed for tree-sitter to detect patch context
const PATCH_TEXT = "BEGIN ~comp~\nCOPY_EXISTING ~spell.spl~ ~override~\n  WRITE_BYTE 0x00 0\n  ";
const PATCH_LINE = 3;
const PATCH_COL = 2;

describe("weidu-tp2: keyword snippet integration in patch context", () => {
    it("inserts SET snippet with tab stops", () => {
        const item = findCompletion(PATCH_TEXT, PATCH_LINE, PATCH_COL, "SET");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe("SET ${1} = ${2}$0");
    });

    it("inserts SPRINT snippet with tab stops and quotes", () => {
        const item = findCompletion(PATCH_TEXT, PATCH_LINE, PATCH_COL, "SPRINT");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe('SPRINT ${1} "${2}"$0');
    });

    it("inserts TEXT_SPRINT snippet with tab stops and quotes", () => {
        const item = findCompletion(PATCH_TEXT, PATCH_LINE, PATCH_COL, "TEXT_SPRINT");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe('TEXT_SPRINT ${1} "${2}"$0');
    });

    it("does not add snippet for non-SET/SPRINT keywords like WRITE_BYTE", () => {
        const item = findCompletion(PATCH_TEXT, PATCH_LINE, PATCH_COL, "WRITE_BYTE");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBeUndefined();
    });
});

const ACTION_TEXT = "BEGIN ~my component~\n";
const ACTION_LINE = 1;
const ACTION_COL = 0;

describe("weidu-tp2: keyword snippet integration in action context", () => {
    it("inserts OUTER_SET snippet", () => {
        const item = findCompletion(ACTION_TEXT, ACTION_LINE, ACTION_COL, "OUTER_SET");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe("OUTER_SET ${1} = ${2}$0");
    });

    it("inserts OUTER_SPRINT snippet with quotes", () => {
        const item = findCompletion(ACTION_TEXT, ACTION_LINE, ACTION_COL, "OUTER_SPRINT");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe('OUTER_SPRINT ${1} "${2}"$0');
    });

    it("inserts OUTER_TEXT_SPRINT snippet with quotes", () => {
        const item = findCompletion(ACTION_TEXT, ACTION_LINE, ACTION_COL, "OUTER_TEXT_SPRINT");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe('OUTER_TEXT_SPRINT ${1} "${2}"$0');
    });
});

const LPF_TEXT = "COPY_EXISTING ~spell.spl~ ~override~\n  LPF ";
const LPF_LINE = 1;
const LPF_COL = 6;

describe("weidu-tp2: snippet integration in lpfName context", () => {
    it("inserts multi-line snippet for function with params", () => {
        const item = findCompletion(LPF_TEXT, LPF_LINE, LPF_COL, "func_with_params");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe("func_with_params\n    $0\nEND");
    });

    it("inserts single-line snippet for function without params", () => {
        const item = findCompletion(LPF_TEXT, LPF_LINE, LPF_COL, "func_no_params");
        expect(item).toBeDefined();
        // No params: no snippet, just plain text insert
        expect(item!.insertTextFormat).toBeUndefined();
        expect(item!.insertText).toBeUndefined();
    });

    it("auto-inserts required param blocks for function with required params", () => {
        const item = findCompletion(LPF_TEXT, LPF_LINE, LPF_COL, "func_required_params");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe(
            "func_required_params\n" +
                "    INT_VAR\n" +
                "        count = ${1}\n" +
                "    STR_VAR\n" +
                "        name = ${2}\n" +
                "END$0",
        );
    });

    it("filters out macros from lpfName context", () => {
        const item = findCompletion(LPF_TEXT, LPF_LINE, LPF_COL, "my_patch_macro");
        expect(item).toBeUndefined();
    });

    it("auto-inserts RET and RET_ARRAY blocks for function with ret params", () => {
        const item = findCompletion(LPF_TEXT, LPF_LINE, LPF_COL, "func_with_ret");
        expect(item).toBeDefined();
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertText).toBe(
            "func_with_ret\n    RET\n        success\n    RET_ARRAY\n        items\nEND$0",
        );
    });
});
