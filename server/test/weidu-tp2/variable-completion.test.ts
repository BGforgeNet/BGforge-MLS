/**
 * Unit tests for WeiDU TP2 variable completion.
 * Tests local variable completion and header variable completion (with JSDoc).
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

// Mock isSubpath to always return true (files don't actually exist on disk for these tests)
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
import { normalizeUri } from "../../src/core/normalized-uri";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

describe("weidu-tp2: local variable completion", () => {
    it("provides completions for OUTER_SET variables", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 20 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const myVarItem = filteredItems.find((item) => item.label === "my_var");
        expect(myVarItem).toBeDefined();
        expect(myVarItem?.kind).toBe(6); // CompletionItemKind.Variable
    });

    it("provides completions for OUTER_TEXT_SPRINT variables", () => {
        const text = `
OUTER_TEXT_SPRINT mod_folder ~mymod~
COPY ~%mod_folder%/file.txt~ ~override~
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 9 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const modFolderItem = filteredItems.find((item) => item.label === "mod_folder");
        expect(modFolderItem).toBeDefined();
        expect(modFolderItem?.kind).toBe(6);
    });

    it("provides completions for SET variables in functions", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR param = 0
BEGIN
    SET local_var = param + 1
    PATCH_PRINT ~local_var = %local_var%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 5, character: 31 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const localVarItem = filteredItems.find((item) => item.label === "local_var");
        expect(localVarItem).toBeDefined();
        expect(localVarItem?.kind).toBe(6);
    });

    it("provides completions for INT_VAR parameters", () => {
        const text = `
DEFINE_PATCH_FUNCTION AddItem
    INT_VAR count = 1
BEGIN
    SET total = count * 2
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 4, character: 16 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const countItem = filteredItems.find((item) => item.label === "count");
        expect(countItem).toBeDefined();
        expect(countItem?.kind).toBe(6);
    });

    it("provides completions for STR_VAR parameters", () => {
        const text = `
DEFINE_ACTION_FUNCTION PrintMessage
    STR_VAR message = ~default~
BEGIN
    ACTION_PRINT ~%message%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 4, character: 20 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const messageItem = filteredItems.find((item) => item.label === "message");
        expect(messageItem).toBeDefined();
        expect(messageItem?.kind).toBe(6);
    });

    it("provides completions for FOR_EACH loop variables", () => {
        const text = `
ACTION_DEFINE_ARRAY colors BEGIN ~red~ ~green~ ~blue~ END
ACTION_FOR_EACH color IN colors BEGIN
    OUTER_SPRINT msg ~Color: %color%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 3, character: 31 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const colorItem = filteredItems.find((item) => item.label === "color");
        expect(colorItem).toBeDefined();
        expect(colorItem?.kind).toBe(6);
    });

    it("provides completions for PHP_EACH loop variables", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
END
ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT msg ~%potion%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 5, character: 24 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const potionItem = filteredItems.find((item) => item.label === "potion");
        const stringItem = filteredItems.find((item) => item.label === "string");
        expect(potionItem).toBeDefined();
        expect(stringItem).toBeDefined();
        expect(potionItem?.kind).toBe(6);
        expect(stringItem?.kind).toBe(6);
    });

    it("provides completions for array variables", () => {
        const text = `
ACTION_DEFINE_ARRAY my_array BEGIN ~item1~ ~item2~ END
ACTION_FOR_EACH item IN my_array BEGIN
    PRINT ~%item%~
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 30 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const arrayItem = filteredItems.find((item) => item.label === "my_array");
        expect(arrayItem).toBeDefined();
        expect(arrayItem?.kind).toBe(6);
    });

    it("does not duplicate variables with same name", () => {
        const text = `
OUTER_SET x = 1
OUTER_SET x = 2
OUTER_SET x = 3
COPY ~a~ ~b~
`;
        const uri = normalizeUri("file:///test.tp2");
        // Position on a non-declaration line where completions should fire
        const position: Position = { line: 4, character: 5 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const xItems = filteredItems.filter((item) => item.label === "x");
        // Should only have one completion for 'x' despite multiple declarations
        expect(xItems.length).toBe(1);
    });
});

describe("weidu-tp2: header variable completion via Symbols", () => {
    // These tests verify that header variables are correctly indexed in Symbols.
    // The provider uses Symbols as the single source of truth for header data.

    it("includes header variables with JSDoc in completions", () => {
        // Parse header content to symbols
        const tphUri = normalizeUri("file:///test-header.tph");
        const tphContent = `
/**
 * Module folder path.
 * @type {string}
 */
OUTER_TEXT_SPRINT mod_folder ~mymod~
`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // The variable should be in the index
        const modFolderSymbol = weiduTp2Provider.resolveSymbol!("mod_folder", "", normalizeUri(""));
        expect(modFolderSymbol).toBeDefined();
        expect(modFolderSymbol?.completion.kind).toBe(6); // CompletionItemKind.Variable

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("includes header variables without JSDoc in completions", () => {
        // Load a header with a variable that has NO JSDoc
        const tphUri = normalizeUri("file:///test-no-jsdoc.tph");
        const tphContent = `OUTER_TEXT_SPRINT no_jsdoc ~value~`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // All top-level variables from .tph should appear
        const noJsdocSymbol = weiduTp2Provider.resolveSymbol!("no_jsdoc", "", normalizeUri(""));
        expect(noJsdocSymbol).toBeDefined();
        expect(noJsdocSymbol?.completion.kind).toBe(6); // CompletionItemKind.Variable

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("provides hover info for header variables with JSDoc", () => {
        // Load a header with a variable that has JSDoc
        const tphUri = normalizeUri("file:///test-hover.tph");
        const tphContent = `
/**
 * Configuration flag for debug mode.
 * @type {int}
 */
OUTER_SET debug_mode = 0
`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Get hover from symbol
        const symbol = weiduTp2Provider.resolveSymbol!("debug_mode", "", normalizeUri(""));
        expect(symbol?.hover).toBeDefined();
        const contents = symbol?.hover.contents;
        if (contents && typeof contents === "object" && "value" in contents) {
            expect(contents.value).toContain("int debug_mode");
            // Non-UPPERCASE: should not show value
            expect(contents.value).not.toContain("= 0");
            expect(contents.value).toContain("Configuration flag for debug mode");
        }

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("clears header variables when file is removed from index", () => {
        // Load a header
        const tphUri = normalizeUri("file:///test-clear.tph");
        const tphContent = `OUTER_TEXT_SPRINT temp_var ~value~`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Verify it's in the index
        expect(weiduTp2Provider.resolveSymbol!("temp_var", "", normalizeUri(""))).toBeDefined();

        // Clear the file
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);

        // Verify it's removed
        expect(weiduTp2Provider.resolveSymbol!("temp_var", "", normalizeUri(""))).toBeUndefined();
    });

    it("does not show value for non-UPPERCASE variables", () => {
        const tphUri = normalizeUri("file:///test-type-value.tph");
        const tphContent = `OUTER_SET test123 = 120
OUTER_TEXT_SPRINT mod_folder ~mymod~`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Non-UPPERCASE: should show type and name only
        const intSymbol = weiduTp2Provider.resolveSymbol!("test123", "", normalizeUri(""));
        expect(intSymbol?.hover).toBeDefined();
        if (
            intSymbol?.hover.contents &&
            typeof intSymbol.hover.contents === "object" &&
            "value" in intSymbol.hover.contents
        ) {
            expect(intSymbol.hover.contents.value).toContain("int test123");
            expect(intSymbol.hover.contents.value).not.toContain("= 120");
        }

        const strSymbol = weiduTp2Provider.resolveSymbol!("mod_folder", "", normalizeUri(""));
        expect(strSymbol?.hover).toBeDefined();
        if (
            strSymbol?.hover.contents &&
            typeof strSymbol.hover.contents === "object" &&
            "value" in strSymbol.hover.contents
        ) {
            expect(strSymbol.hover.contents.value).toContain("string mod_folder");
            expect(strSymbol.hover.contents.value).not.toContain("= ~mymod~");
        }

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("shows value for UPPERCASE constant variables", () => {
        const tphUri = normalizeUri("file:///test-const-value.tph");
        const tphContent = `OUTER_SET MAX_LEVEL = 40
OUTER_TEXT_SPRINT MOD_FOLDER ~mymod~`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // UPPERCASE: should show type, name, AND value
        const intSymbol = weiduTp2Provider.resolveSymbol!("MAX_LEVEL", "", normalizeUri(""));
        expect(intSymbol?.hover).toBeDefined();
        if (
            intSymbol?.hover.contents &&
            typeof intSymbol.hover.contents === "object" &&
            "value" in intSymbol.hover.contents
        ) {
            expect(intSymbol.hover.contents.value).toContain("int MAX_LEVEL = 40");
        }

        const strSymbol = weiduTp2Provider.resolveSymbol!("MOD_FOLDER", "", normalizeUri(""));
        expect(strSymbol?.hover).toBeDefined();
        if (
            strSymbol?.hover.contents &&
            typeof strSymbol.hover.contents === "object" &&
            "value" in strSymbol.hover.contents
        ) {
            expect(strSymbol.hover.contents.value).toContain("string MOD_FOLDER = ~mymod~");
        }

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });

    it("respects JSDoc @type override for variables", () => {
        const tphUri = normalizeUri("file:///test-type-override.tph");
        const tphContent = `/**
 * @type {resref}
 */
OUTER_TEXT_SPRINT spell ~SPWI101~`;
        weiduTp2Provider.reloadFileData!(tphUri, tphContent);

        // Test JSDoc @type overrides inferred type
        const symbol = weiduTp2Provider.resolveSymbol!("spell", "", normalizeUri(""));
        expect(symbol?.hover).toBeDefined();
        if (symbol?.hover.contents && typeof symbol.hover.contents === "object" && "value" in symbol.hover.contents) {
            expect(symbol.hover.contents.value).toContain("resref spell");
            // Non-UPPERCASE: should not show value
            expect(symbol.hover.contents.value).not.toContain("= ~SPWI101~");
        }

        // Cleanup
        weiduTp2Provider.onWatchedFileDeleted!(tphUri);
    });
});

describe("weidu-tp2: JSDoc comment completions", () => {
    it("returns JSDoc tags at @ position inside single-line JSDoc comment", () => {
        // "/** @ */" — cursor at col 5, right after @
        const text = `/** @ */\nOUTER_SET x = 1\n`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 0, character: 5 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const labels = filteredItems.map((item) => item.label);
        expect(labels).toContain("@type");
        expect(labels).toContain("@param");
        // Tags only — types not shown at @ position
        expect(labels).not.toContain("int");
        // Should NOT have code completions
        expect(labels).not.toContain("x");
    });

    it("returns JSDoc types at type position inside single-line JSDoc comment", () => {
        // "/** @type  */" — cursor at col 10, after "@type "
        const text = `/** @type  */\nOUTER_SET x = 1\n`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 0, character: 10 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const labels = filteredItems.map((item) => item.label);
        expect(labels).toContain("int");
        expect(labels).toContain("string");
        // Types only — tags not shown at type position
        expect(labels).not.toContain("@type");
        // Should NOT have code completions
        expect(labels).not.toContain("x");
    });

    it("returns JSDoc tags at @ position inside multi-line JSDoc comment", () => {
        // Line 1 is " * @" — cursor at col 4, right after @
        const text = `/**\n * @\n */\nOUTER_SET x = 1\n`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 1, character: 4 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const labels = filteredItems.map((item) => item.label);
        expect(labels).toContain("@type");
        expect(labels).toContain("@param");
    });

    it("returns no JSDoc completions on empty JSDoc line", () => {
        // Line 1 is " * " — cursor at col 3, no @ typed yet
        const text = `/**\n * \n */\nOUTER_SET x = 1\n`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 1, character: 3 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        expect(filteredItems).toHaveLength(0);
    });

    it("returns empty completions inside regular block comment", () => {
        const text = `/* regular comment */\nOUTER_SET x = 1\n`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 0, character: 10 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        expect(filteredItems).toHaveLength(0);
    });

    it("returns empty completions inside line comment", () => {
        const text = `// line comment\nOUTER_SET x = 1\n`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 0, character: 5 };

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        expect(filteredItems).toHaveLength(0);
    });
});
