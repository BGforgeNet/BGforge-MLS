/**
 * Unit tests for WeiDU TP2 header parser.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { parseHeaderVariables, parseFile } from "../../src/weidu-tp2/header-parser";
import { initParser } from "../../src/weidu-tp2/parser";

beforeAll(async () => {
    await initParser();
});

describe("parseHeaderVariables", () => {
    describe("top-level variable extraction", () => {
        it("extracts OUTER_SET variables", () => {
            const input = `OUTER_SET count = 10`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("count");
            expect(result[0].declarationKind).toBe("set");
            expect(result[0].inferredType).toBe("int");
            expect(result[0].value).toBe("10");
        });

        it("extracts OUTER_SPRINT variables", () => {
            const input = `OUTER_SPRINT name ~hello~`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("name");
            expect(result[0].declarationKind).toBe("sprint");
            expect(result[0].inferredType).toBe("string");
            expect(result[0].value).toBe("~hello~");
        });

        it("strips tilde delimiters from OUTER_SPRINT variable names", () => {
            const input = `OUTER_SPRINT ~SCROLL_WIZARD~ ~SCRL9P~`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("SCROLL_WIZARD");
            expect(result[0].declarationKind).toBe("sprint");
        });

        it("strips tilde delimiters from OUTER_TEXT_SPRINT variable names", () => {
            const input = `OUTER_TEXT_SPRINT ~MY_PATH~ ~override~`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("MY_PATH");
            expect(result[0].declarationKind).toBe("text_sprint");
        });

        it("extracts OUTER_TEXT_SPRINT variables", () => {
            const input = `OUTER_TEXT_SPRINT content ~file.txt~`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("content");
            expect(result[0].declarationKind).toBe("text_sprint");
            expect(result[0].inferredType).toBe("string");
        });
    });

    describe("function body scope isolation", () => {
        it("does not extract variables from DEFINE_ACTION_FUNCTION body", () => {
            const input = `
DEFINE_ACTION_FUNCTION test_func BEGIN
    OUTER_SET local_count = 5
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(0);
        });

        it("does not extract variables from DEFINE_PATCH_FUNCTION body", () => {
            const input = `
DEFINE_PATCH_FUNCTION test_func BEGIN
    SET patch_var = 42
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(0);
        });

        it("does not extract variables from nested blocks inside functions", () => {
            const input = `
DEFINE_ACTION_FUNCTION outer BEGIN
    ACTION_IF flag BEGIN
        OUTER_SET nested_var = 100
    END
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(0);
        });

        it("extracts file-scope variable but not function-local ones", () => {
            const input = `
OUTER_SET global_var = 1
DEFINE_ACTION_FUNCTION test_func BEGIN
    OUTER_SET local_var = 5
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("global_var");
        });

        it("extracts variables nested in control flow outside functions", () => {
            const input = `
ACTION_IF flag BEGIN
    OUTER_SET nested_var = 100
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("nested_var");
        });
    });

    describe("JSDoc support", () => {
        it("extracts JSDoc with @type from top-level variable", () => {
            const input = `
/**
 * Counter for items.
 * @type int
 */
OUTER_SET item_count = 0`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("item_count");
            expect(result[0].jsdoc).toBeDefined();
            expect(result[0].jsdoc?.type).toBe("int");
            expect(result[0].jsdoc?.desc).toBe("Counter for items.");
        });

        it("does not extract JSDoc variables from inside function bodies", () => {
            const input = `
DEFINE_ACTION_FUNCTION test BEGIN
    /**
     * Temporary storage.
     * @type string
     */
    OUTER_SPRINT temp_str ~default~
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(0);
        });

        it("handles variables without JSDoc", () => {
            const input = `
// Regular comment
OUTER_SET no_doc = 5`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("no_doc");
            expect(result[0].jsdoc).toBeUndefined();
        });
    });

    describe("multiple top-level variables", () => {
        it("extracts multiple OUTER_SET variables", () => {
            const input = `
OUTER_SET count = 1
OUTER_SET max_count = 100`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("count");
            expect(result[1].name).toBe("max_count");
        });

        it("extracts mixed declaration types", () => {
            const input = `
OUTER_SET num = 42
OUTER_SPRINT label ~hello~
OUTER_TEXT_SPRINT path ~file.txt~`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(3);
            expect(result[0].declarationKind).toBe("set");
            expect(result[1].declarationKind).toBe("sprint");
            expect(result[2].declarationKind).toBe("text_sprint");
        });
    });

    describe("function definitions are fully excluded", () => {
        it("does not include params or body variables from DEFINE_ACTION_FUNCTION", () => {
            const input = `
OUTER_SET global = 99
DEFINE_ACTION_FUNCTION my_func
    INT_VAR bonus = 0
    STR_VAR name = ~~
BEGIN
    OUTER_SET local_var = 1
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("global");
        });

        it("does not include params or body variables from DEFINE_PATCH_FUNCTION", () => {
            const input = `
OUTER_SET global = 99
DEFINE_PATCH_FUNCTION my_func
    RET result
    RET_ARRAY results
BEGIN
    SET local_var = 42
END`;
            const result = parseHeaderVariables(input, "test://file.tph");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("global");
        });
    });
});

// =============================================================================
// Symbol conversion tests - verifies IndexedSymbol output
// These tests ensure hover content includes all JSDoc features
// =============================================================================

/** Extract symbols only (convenience wrapper). */
const parseHeaderToSymbols = (...args: Parameters<typeof parseFile>) => [...parseFile(...args).symbols];
import { isCallableSymbol, isVariableSymbol } from "../../src/core/symbol";
import { CompletionCategory, type CompletionItemWithCategory } from "../../src/shared/completion-context";
import type { MarkupContent } from "vscode-languageserver/node";

describe("parseHeaderToSymbols", () => {
    // Use realistic paths for all tests
    const workspaceRoot = "/home/user/mymod";
    const uri = "file:///home/user/mymod/lib/functions.tph";
    const displayPath = "lib/functions.tph";

    describe("function hover content", () => {
        it("generates complete hover for simple function", () => {
            const input = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const sym = symbols[0];

            expect(isCallableSymbol(sym)).toBe(true);
            expect(sym.source.displayPath).toBe(displayPath);
            const hoverContent = sym.hover.contents as MarkupContent;
            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function my_func
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\``
            );
        });

        it("generates complete hover with JSDoc description", () => {
            const input = `
/**
 * Applies bonus to armor.
 */
DEFINE_PATCH_FUNCTION apply_armor_bonus BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
patch function apply_armor_bonus
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Applies bonus to armor.`
            );
        });

        it("generates complete hover with @arg parameter table", () => {
            const input = `
/**
 * Test function.
 * @arg {int} bonus! the bonus amount
 * @arg {string} name item name to use
 */
DEFINE_ACTION_FUNCTION test_func
    INT_VAR bonus = 0
    STR_VAR name = ""
BEGIN
END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function test_func
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Test function.

| | | | |
|-:|:-|:-|:-|
|**INT**|**vars**|||
|[int](https://ielib.bgforge.net/types#int)|bonus||&nbsp;&nbsp;the bonus amount|
|**STR**|**vars**|||
|[string](https://ielib.bgforge.net/types#string)|name|=&nbsp;""|&nbsp;&nbsp;item name to use|`
            );
        });

        it("generates complete hover with @return type", () => {
            const input = `
/**
 * Returns a value.
 * @return {int}
 */
DEFINE_ACTION_FUNCTION get_value BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function get_value
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Returns a value.`
            );
        });

        it("generates complete hover with @deprecated notice", () => {
            const input = `
/**
 * Old function.
 * @deprecated Use new_func instead
 */
DEFINE_ACTION_FUNCTION old_func BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function old_func
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Old function.

**Deprecated:** Use new_func instead`
            );
        });

        it("links known types to ielib documentation in parameter table", () => {
            const input = `
/**
 * Uses an item.
 * @arg {resref} item the item resref
 */
DEFINE_ACTION_FUNCTION use_item
    STR_VAR item = ""
BEGIN
END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function use_item
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Uses an item.

| | | | |
|-:|:-|:-|:-|
|**STR**|**vars**|||
|[resref](https://ielib.bgforge.net/types#resref)|item|=&nbsp;""|&nbsp;&nbsp;the item resref|`
            );
        });
    });

    describe("displayPath computation", () => {
        it("shows workspace-relative path when inside workspace", () => {
            const input = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const sym = symbols[0];
            const hoverContent = sym.hover.contents as MarkupContent;

            expect(sym.source.displayPath).toBe("lib/functions.tph");
            expect(hoverContent.value).toContain("lib/functions.tph");
        });

        it("shows filename only when no workspace root provided", () => {
            const input = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input); // no workspaceRoot
            const sym = symbols[0];
            const hoverContent = sym.hover.contents as MarkupContent;

            expect(sym.source.displayPath).toBe("functions.tph");
            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function my_func
\`\`\`
\`\`\`bgforge-mls-comment
functions.tph
\`\`\``
            );
        });

        it("shows filename when file is outside workspace", () => {
            const input = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
            const outsideUri = "file:///other/project/utils.tph";
            const symbols = parseHeaderToSymbols(outsideUri, input, workspaceRoot);
            const sym = symbols[0];
            const hoverContent = sym.hover.contents as MarkupContent;

            expect(sym.source.displayPath).toBe("utils.tph");
            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
action function my_func
\`\`\`
\`\`\`bgforge-mls-comment
utils.tph
\`\`\``
            );
        });
    });

    describe("variable hover content", () => {
        it("generates complete hover for simple variable (no value for lowercase)", () => {
            const input = `OUTER_SET my_var = 42`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const sym = symbols[0];

            expect(isVariableSymbol(sym)).toBe(true);
            expect(sym.source.displayPath).toBe(displayPath);
            const hoverContent = sym.hover.contents as MarkupContent;
            // Lowercase variable: type + name only, no value
            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
int my_var
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\``
            );
        });

        it("generates complete hover with JSDoc description and @type (no value for lowercase)", () => {
            const input = `
/**
 * Maximum item count.
 * @type int
 */
OUTER_SET max_items = 100`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            // Lowercase variable: type + name only, no value
            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
int max_items
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Maximum item count.`
            );
        });

        it("generates complete hover with @deprecated notice", () => {
            const input = `
/**
 * Old constant.
 * @deprecated Use NEW_VALUE instead
 */
OUTER_SET OLD_VALUE = 5`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
int OLD_VALUE = 5
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\`

---

Old constant.

**Deprecated:** Use NEW_VALUE instead`
            );
        });

        it("generates complete hover for string variable (no value for lowercase)", () => {
            const input = `OUTER_SPRINT my_str ~hello~`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const hoverContent = symbols[0].hover.contents as MarkupContent;

            // Lowercase variable: type + name only, no value
            expect(hoverContent.value).toBe(
`\`\`\`weidu-tp2-tooltip
string my_str
\`\`\`
\`\`\`bgforge-mls-comment
lib/functions.tph
\`\`\``
            );
        });
    });

    describe("mixed content", () => {
        it("converts both functions and variables from same file", () => {
            const input = `
OUTER_SET global_count = 0

DEFINE_ACTION_FUNCTION increment_count BEGIN
END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);

            expect(symbols).toHaveLength(2);
            expect(symbols.some(s => s.name === "global_count")).toBe(true);
            expect(symbols.some(s => s.name === "increment_count")).toBe(true);
        });
    });

    describe("completion category assignment", () => {
        it("assigns action_functions category to DEFINE_ACTION_FUNCTION symbols", () => {
            const input = `DEFINE_ACTION_FUNCTION my_func BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const completion = symbols[0].completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.ActionFunctions);
        });

        it("assigns patch_functions category to DEFINE_PATCH_FUNCTION symbols", () => {
            const input = `DEFINE_PATCH_FUNCTION my_patch BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const completion = symbols[0].completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.PatchFunctions);
        });

        it("assigns action_macros category to DEFINE_ACTION_MACRO symbols", () => {
            const input = `DEFINE_ACTION_MACRO my_macro BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const completion = symbols[0].completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.ActionMacros);
        });

        it("assigns patch_macros category to DEFINE_PATCH_MACRO symbols", () => {
            const input = `DEFINE_PATCH_MACRO my_patch_macro BEGIN END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const completion = symbols[0].completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.PatchMacros);
        });

        it("assigns vars category to OUTER_SET variable symbols", () => {
            const input = `OUTER_SET my_var = 42`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const completion = symbols[0].completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.Vars);
        });

        it("assigns vars category to OUTER_SPRINT variable symbols", () => {
            const input = `OUTER_SPRINT my_str ~hello~`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const completion = symbols[0].completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.Vars);
        });
    });

    describe("callable symbol params include JSDoc data", () => {
        it("includes @arg descriptions in callable.params", () => {
            const input = `
/**
 * Test function.
 * @arg {int} bonus! the bonus amount
 * @arg {string} name item name to use
 */
DEFINE_ACTION_FUNCTION test_func
    INT_VAR bonus = 0
    STR_VAR name = ""
BEGIN
END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const sym = symbols[0];

            expect(isCallableSymbol(sym)).toBe(true);
            if (!isCallableSymbol(sym)) return;

            // Verify params have JSDoc descriptions
            expect(sym.callable.params?.intVar[0].name).toBe("bonus");
            expect(sym.callable.params?.intVar[0].description).toBe("the bonus amount");
            expect(sym.callable.params?.intVar[0].required).toBe(true);

            expect(sym.callable.params?.strVar[0].name).toBe("name");
            expect(sym.callable.params?.strVar[0].description).toBe("item name to use");
            expect(sym.callable.params?.strVar[0].required).toBeFalsy();
        });

        it("includes @arg type override in callable.params", () => {
            const input = `
/**
 * @arg {resref} item the item resref
 */
DEFINE_ACTION_FUNCTION use_item
    STR_VAR item = ""
BEGIN
END`;
            const symbols = parseHeaderToSymbols(uri, input, workspaceRoot);
            const sym = symbols[0];

            expect(isCallableSymbol(sym)).toBe(true);
            if (!isCallableSymbol(sym)) return;

            // Type from @arg should override default "string"
            expect(sym.callable.params?.strVar[0].type).toBe("resref");
        });

    });
});
