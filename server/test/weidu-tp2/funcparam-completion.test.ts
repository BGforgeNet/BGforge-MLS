/**
 * Unit tests for WeiDU TP2 function parameter completion.
 * Tests parameter name completion for LAF/LPF calls.
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
import { normalizeUri } from "../../src/core/normalized-uri";
import * as path from "path";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

describe("weidu-tp2: function parameter completion", () => {
    it("provides INT_VAR parameter completions for LAF", () => {
        // Define a function in header file
        const headerText = `
DEFINE_ACTION_FUNCTION my_action_func
    INT_VAR
        count = 0
        max = 100
    STR_VAR
        name = "default"
BEGIN
    PRINT ~Function called~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");

        // Index the header file
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        // Test completion in caller file - cursor on new line after first param
        const text = `INCLUDE ~lib.tph~
LAF my_action_func
INT_VAR count = 5

END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 3, character: 0 }; // On blank line inside INT_VAR section

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Should suggest only max (count is already used)
        const countItem = filteredItems.find((item) => item.label === "count");
        const maxItem = filteredItems.find((item) => item.label === "max");

        expect(countItem).toBeUndefined(); // Already used
        expect(maxItem).toBeDefined();
        expect(maxItem?.insertText).toBe("max = ");
        // Documentation contains signature like "int max = 100"
        const maxDoc = maxItem?.documentation;
        expect(maxDoc && typeof maxDoc === "object" && "value" in maxDoc ? maxDoc.value : "").toContain(
            "int max = 100",
        );
    });

    it("provides STR_VAR parameter completions for LPF", () => {
        const headerText = `
DEFINE_PATCH_FUNCTION my_patch_func
    STR_VAR
        source = ""
        target = ""
BEGIN
    PATCH_PRINT ~Patching~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
COPY ~file.bcs~ ~override~
    LPF my_patch_func STR_VAR  END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 29 }; // After "STR_VAR "

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const sourceItem = filteredItems.find((item) => item.label === "source");
        const targetItem = filteredItems.find((item) => item.label === "target");

        expect(sourceItem).toBeDefined();
        expect(sourceItem?.insertText).toBe("source = ");

        expect(targetItem).toBeDefined();
        expect(targetItem?.insertText).toBe("target = ");
    });

    it("filters out already-used parameters", () => {
        const headerText = `
DEFINE_ACTION_FUNCTION test_func
    INT_VAR
        param1 = 1
        param2 = 2
        param3 = 3
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
LAF test_func
INT_VAR
    param1 = 10

END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 4, character: 0 }; // On blank line inside INT_VAR section (funcParamName context)

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Should not suggest param1 (already used)
        const param1Item = filteredItems.find((item) => item.label === "param1");
        expect(param1Item).toBeUndefined();

        // Should suggest param2 and param3
        const param2Item = filteredItems.find((item) => item.label === "param2");
        const param3Item = filteredItems.find((item) => item.label === "param3");

        expect(param2Item).toBeDefined();
        expect(param3Item).toBeDefined();
    });

    it("provides RET parameter completions", () => {
        const headerText = `
DEFINE_PATCH_FUNCTION get_value
    RET
        result
        error_code
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
COPY ~file.bcs~ ~override~
    LPF get_value RET  END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 23 }; // After "RET "

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const resultItem = filteredItems.find((item) => item.label === "result");
        const errorCodeItem = filteredItems.find((item) => item.label === "error_code");

        expect(resultItem).toBeDefined();
        expect(resultItem?.insertText).toBe("result = ");

        expect(errorCodeItem).toBeDefined();
        expect(errorCodeItem?.insertText).toBe("error_code = ");
    });

    it("returns no completions for unknown functions", () => {
        const text = `
LAF unknown_function INT_VAR  END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 1, character: 30 }; // After "INT_VAR "

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Should not have any function-specific param completions
        // (but may have general completions from static data)
        const hasParamCompletions = filteredItems.some(
            (item) => item.insertText?.endsWith(" = ") && item.kind === 5, // CompletionItemKind.Field
        );

        expect(hasParamCompletions).toBe(false);
    });

    it("provides STR_VAR parameter completions in function with both INT_VAR and STR_VAR", () => {
        const headerText = `
DEFINE_ACTION_FUNCTION mixed_params_func
    INT_VAR
        count = 0
        max = 100
    STR_VAR
        xxxs = "bzzzz"
BEGIN
    PRINT ~test~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
LAF mixed_params_func
INT_VAR count = 5
STR_VAR
END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 3, character: 7 }; // In STR_VAR section

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const xxxsItem = filteredItems.find((item) => item.label === "xxxs");
        expect(xxxsItem).toBeDefined();
        expect(xxxsItem?.insertText).toBe("xxxs = ");
        // Documentation contains signature like 'string xxxs = "bzzzz"'
        const xxxsDoc = xxxsItem?.documentation;
        expect(xxxsDoc && typeof xxxsDoc === "object" && "value" in xxxsDoc ? xxxsDoc.value : "").toContain(
            "string xxxs",
        );
    });

    it("provides STR_VAR completions when typing partial param name in incomplete STR_VAR section", () => {
        // Bug reproduction: when STR_VAR section has incomplete text (user typing),
        // tree-sitter may incorrectly bound section ranges, causing cursor to be
        // detected as in INT_VAR instead of STR_VAR
        const headerText = `
DEFINE_PATCH_FUNCTION unstack_armor_bonus
    INT_VAR
        bonus = 0
        stacking_id_base = 0
    STR_VAR
        xxxs = "bzzzz"
BEGIN
    PATCH_PRINT ~test~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        // Simulates user typing "xxx" in STR_VAR section with incomplete INT_VAR assignments
        // This matches the exact scenario where INT_VAR has "bonus =" without value
        const text = `
COPY ~file.2da~ ~override~
    LPF unstack_armor_bonus
    INT_VAR
        bonus =
    STR_VAR
        xxx
    END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 6, character: 11 }; // After "xxx" in STR_VAR section

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Should suggest xxxs (STR_VAR param), not stacking_id_base (INT_VAR param)
        const xxxsItem = filteredItems.find((item) => item.label === "xxxs");
        const intVarItem = filteredItems.find((item) => item.label === "stacking_id_base");

        expect(xxxsItem).toBeDefined();
        expect(xxxsItem?.insertText).toBe("xxxs = ");
        // INT_VAR params should NOT appear when in STR_VAR section
        expect(intVarItem).toBeUndefined();
    });

    it("returns no completions for macros (LAM/LPM)", () => {
        const headerText = `
DEFINE_ACTION_MACRO my_macro
BEGIN
    PRINT ~Macro called~
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
LAM my_macro
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 1, character: 12 }; // After "my_macro"

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        // Macros don't have parameters, so no param completions
        const hasParamCompletions = filteredItems.some((item) => item.insertText?.endsWith(" = ") && item.kind === 5);

        expect(hasParamCompletions).toBe(false);
    });

    it("provides RET_ARRAY parameter completions", () => {
        const headerText = `
DEFINE_PATCH_FUNCTION get_arrays
    RET_ARRAY
        output_list
        error_list
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
COPY ~file.bcs~ ~override~
    LPF get_arrays RET_ARRAY  END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 2, character: 30 }; // After "RET_ARRAY "

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const outputItem = filteredItems.find((item) => item.label === "output_list");
        const errorItem = filteredItems.find((item) => item.label === "error_list");

        expect(outputItem).toBeDefined();
        expect(outputItem?.insertText).toBe("output_list = ");

        expect(errorItem).toBeDefined();
        expect(errorItem?.insertText).toBe("error_list = ");
    });

    it("includes description in completion documentation when JSDoc @param has description", () => {
        const headerText = `
/**
 * A function with a documented parameter.
 * @param {int} item_count - Number of items to process
 */
DEFINE_ACTION_FUNCTION documented_func
    INT_VAR
        item_count = 0
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `
LAF documented_func
INT_VAR

END
`;
        const uri = normalizeUri("file:///test.tp2");
        const position: Position = { line: 3, character: 0 }; // Inside INT_VAR section

        const allItems = weiduTp2Provider.getCompletions?.(uri) ?? [];
        const filteredItems = weiduTp2Provider.filterCompletions?.(allItems, text, position, uri) ?? [];

        const countItem = filteredItems.find((item) => item.label === "item_count");
        expect(countItem).toBeDefined();

        // Documentation should contain the description from JSDoc
        const doc = countItem?.documentation;
        const docValue = doc && typeof doc === "object" && "value" in doc ? doc.value : "";
        expect(docValue).toContain("Number of items to process");
    });
});
