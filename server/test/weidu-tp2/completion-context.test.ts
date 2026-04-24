/**
 * Unit tests for WeiDU TP2 contextual completion.
 * Tests context detection and filtering for the simplified two-concern system:
 * 1. Function name contexts (LAF/LPF/LAM/LPM)
 * 2. Function parameter contexts (INT_VAR/STR_VAR)
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getContextAtPosition } from "../../src/weidu-tp2/completion/context";
import { filterItemsByContext } from "../../src/weidu-tp2/completion/filter";
import { CompletionContext, type Tp2CompletionItem } from "../../src/weidu-tp2/completion/types";
import { initParser } from "../../src/weidu-tp2/parser";
import { CompletionItemKind } from "vscode-languageserver/node";
import { CompletionCategory } from "../../src/shared/completion-context";

beforeAll(async () => {
    await initParser();
});

/** Helper to create a TP2 completion item with required category. */
function createItem(label: string, category: CompletionCategory): Tp2CompletionItem {
    return {
        label,
        kind: CompletionItemKind.Keyword,
        category,
    };
}

/** Helper to check if items are filtered correctly. */
function expectFiltering(
    context: CompletionContext | CompletionContext[],
    category: CompletionCategory,
    shouldBeIncluded: boolean,
) {
    const items = [createItem("TEST_ITEM", category)];
    const contexts = Array.isArray(context) ? context : [context];
    const filtered = filterItemsByContext(items, contexts);
    if (shouldBeIncluded) {
        expect(filtered).toHaveLength(1);
        expect(filtered[0].label).toBe("TEST_ITEM");
    } else {
        expect(filtered).toHaveLength(0);
    }
}

/** Helper to place cursor at a position marked by | in the text. */
function getCursorPosition(textWithCursor: string): { text: string; line: number; character: number } {
    const cursorIndex = textWithCursor.indexOf("|");
    if (cursorIndex === -1) throw new Error("No cursor marker | found");
    const text = textWithCursor.slice(0, cursorIndex) + textWithCursor.slice(cursorIndex + 1);
    const lines = textWithCursor.slice(0, cursorIndex).split("\n");
    return { text, line: lines.length - 1, character: lines[lines.length - 1].length };
}

/** Helper to get contexts at cursor position. */
function getContexts(textWithCursor: string): CompletionContext[] {
    const { text, line, character } = getCursorPosition(textWithCursor);
    return getContextAtPosition(text, line, character);
}

// =========================================================================
// Function Name Context Detection
// =========================================================================
describe("function name context detection", () => {
    it("LAF with space -> LafName", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAF |`);
        expect(contexts).toContain(CompletionContext.LafName);
    });

    it("LPF with space -> LpfName", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LPF |`);
        expect(contexts).toContain(CompletionContext.LpfName);
    });

    it("LAM with space -> LamName", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAM |`);
        expect(contexts).toContain(CompletionContext.LamName);
    });

    it("LPM with space -> LpmName", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LPM |`);
        expect(contexts).toContain(CompletionContext.LpmName);
    });

    it("LPF func_name INT_VAR with cursor on func_name -> LpfName", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LPF func|`);
        expect(contexts).toContain(CompletionContext.LpfName);
    });

    it("incomplete LAF without space -> no name context (text fallback doesn't match)", () => {
        // "LAF" without trailing space: regex FUNC_CALL_KEYWORDS requires whitespace + non-whitespace
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAF|`);
        expect(contexts).not.toContain(CompletionContext.LafName);
    });

    it("LAM inside incomplete BEGIN...END -> LamName (text fallback)", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\n  LAM |`);
        expect(contexts).toContain(CompletionContext.LamName);
    });
});

// =========================================================================
// Function Parameter Context Detection
// =========================================================================
describe("function parameter context detection", () => {
    it("LAF func INT_VAR -> FuncParamName", () => {
        // Use complete enough code for tree-sitter to parse the function call
        const contexts = getContexts(`LAF func INT_VAR | END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("LAF func INT_VAR x = -> FuncParamValue", () => {
        const contexts = getContexts(`LAF func INT_VAR x = | END`);
        expect(contexts).toContain(CompletionContext.FuncParamValue);
    });

    it("STR_VAR inside function call -> FuncParamName", () => {
        const contexts = getContexts(`LAF func STR_VAR | END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("function definition param section -> FuncParamName", () => {
        const contexts = getContexts(`DEFINE_ACTION_FUNCTION my_func INT_VAR | BEGIN END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });
});

// =========================================================================
// Comment/JSDoc Context Detection
// =========================================================================
describe("comment context detection", () => {
    it("inside // comment -> Comment", () => {
        const contexts = getContexts(`// |comment`);
        expect(contexts).toContain(CompletionContext.Comment);
    });

    it("inside /* */ comment -> Comment", () => {
        const contexts = getContexts(`/* |comment */`);
        expect(contexts).toContain(CompletionContext.Comment);
    });

    it("inside /** */ -> Jsdoc", () => {
        const contexts = getContexts(`/** |comment */`);
        expect(contexts).toContain(CompletionContext.Jsdoc);
    });
});

// =========================================================================
// General Context (no filtering)
// =========================================================================
describe("general context - no filtering", () => {
    it("top-level .tpa -> empty contexts (no filtering)", () => {
        const contexts = getContexts(`|`);
        expect(contexts).toEqual([]);
    });

    it("top-level .tp2 after prologue -> empty contexts", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\n|`);
        expect(contexts).toEqual([]);
    });

    it("inside COPY body -> empty contexts (no action/patch filtering)", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  |`);
        expect(contexts).toEqual([]);
    });

    it("inside function definition body -> empty contexts", () => {
        const contexts = getContexts(`DEFINE_ACTION_FUNCTION my_func BEGIN\n  |\nEND`);
        expect(contexts).toEqual([]);
    });

    it("inside patch function body -> empty contexts", () => {
        const contexts = getContexts(`DEFINE_PATCH_FUNCTION my_func BEGIN\n  |\nEND`);
        expect(contexts).toEqual([]);
    });

    it("after component BEGIN -> empty contexts", () => {
        const contexts = getContexts(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\n|`);
        expect(contexts).toEqual([]);
    });
});

// =========================================================================
// Name Context Filtering
// =========================================================================
describe("name context filtering", () => {
    describe("LafName context", () => {
        it("action functions shown", () => {
            expectFiltering(CompletionContext.LafName, CompletionCategory.ActionFunctions, true);
        });
        it("patch functions hidden", () => {
            expectFiltering(CompletionContext.LafName, CompletionCategory.PatchFunctions, false);
        });
        it("dimorphic functions shown", () => {
            expectFiltering(CompletionContext.LafName, CompletionCategory.DimorphicFunctions, true);
        });
        it("action macros hidden", () => {
            expectFiltering(CompletionContext.LafName, CompletionCategory.ActionMacros, false);
        });
        it("constants hidden", () => {
            expectFiltering(CompletionContext.LafName, CompletionCategory.Constants, false);
        });
        it("action commands hidden", () => {
            expectFiltering(CompletionContext.LafName, CompletionCategory.Action, false);
        });
    });

    describe("LpfName context", () => {
        it("patch functions shown", () => {
            expectFiltering(CompletionContext.LpfName, CompletionCategory.PatchFunctions, true);
        });
        it("action functions hidden", () => {
            expectFiltering(CompletionContext.LpfName, CompletionCategory.ActionFunctions, false);
        });
        it("dimorphic functions shown", () => {
            expectFiltering(CompletionContext.LpfName, CompletionCategory.DimorphicFunctions, true);
        });
        it("patch macros hidden", () => {
            expectFiltering(CompletionContext.LpfName, CompletionCategory.PatchMacros, false);
        });
    });

    describe("LamName context", () => {
        it("action macros shown", () => {
            expectFiltering(CompletionContext.LamName, CompletionCategory.ActionMacros, true);
        });
        it("all functions hidden", () => {
            expectFiltering(CompletionContext.LamName, CompletionCategory.ActionFunctions, false);
            expectFiltering(CompletionContext.LamName, CompletionCategory.PatchFunctions, false);
            expectFiltering(CompletionContext.LamName, CompletionCategory.DimorphicFunctions, false);
        });
        it("patch macros hidden", () => {
            expectFiltering(CompletionContext.LamName, CompletionCategory.PatchMacros, false);
        });
    });

    describe("LpmName context", () => {
        it("patch macros shown", () => {
            expectFiltering(CompletionContext.LpmName, CompletionCategory.PatchMacros, true);
        });
        it("all functions hidden", () => {
            expectFiltering(CompletionContext.LpmName, CompletionCategory.ActionFunctions, false);
            expectFiltering(CompletionContext.LpmName, CompletionCategory.PatchFunctions, false);
            expectFiltering(CompletionContext.LpmName, CompletionCategory.DimorphicFunctions, false);
        });
        it("action macros hidden", () => {
            expectFiltering(CompletionContext.LpmName, CompletionCategory.ActionMacros, false);
        });
    });

    describe("all name contexts exclude non-callable categories", () => {
        const nameContexts = [
            CompletionContext.LafName,
            CompletionContext.LpfName,
            CompletionContext.LamName,
            CompletionContext.LpmName,
        ];
        const nonCallableCategories = [
            CompletionCategory.Prologue,
            CompletionCategory.Flag,
            CompletionCategory.ComponentFlag,
            CompletionCategory.Language,
            CompletionCategory.Action,
            CompletionCategory.Patch,
            CompletionCategory.Constants,
            CompletionCategory.Vars,
        ];

        for (const ctx of nameContexts) {
            for (const cat of nonCallableCategories) {
                it(`${cat} hidden in ${ctx}`, () => {
                    expectFiltering(ctx, cat, false);
                });
            }
        }
    });
});

// =========================================================================
// Param Context Filtering
// =========================================================================
describe("param context filtering", () => {
    it("FuncVarKeyword shown in FuncParamName", () => {
        expectFiltering(CompletionContext.FuncParamName, CompletionCategory.FuncVarKeyword, true);
    });

    it("FuncVarKeyword hidden in FuncParamValue", () => {
        expectFiltering(CompletionContext.FuncParamValue, CompletionCategory.FuncVarKeyword, false);
    });

    it("FuncVarKeyword hidden in all name contexts", () => {
        expectFiltering(CompletionContext.LafName, CompletionCategory.FuncVarKeyword, false);
        expectFiltering(CompletionContext.LpfName, CompletionCategory.FuncVarKeyword, false);
        expectFiltering(CompletionContext.LamName, CompletionCategory.FuncVarKeyword, false);
        expectFiltering(CompletionContext.LpmName, CompletionCategory.FuncVarKeyword, false);
    });

    it("value categories allowed in FuncParamValue", () => {
        expectFiltering(CompletionContext.FuncParamValue, CompletionCategory.Constants, true);
        expectFiltering(CompletionContext.FuncParamValue, CompletionCategory.Vars, true);
    });

    it("value categories hidden in FuncParamName", () => {
        expectFiltering(CompletionContext.FuncParamName, CompletionCategory.Constants, false);
        expectFiltering(CompletionContext.FuncParamName, CompletionCategory.Vars, false);
    });
});

// =========================================================================
// No Context (empty array) — Show Everything
// =========================================================================
describe("no context (general completion)", () => {
    it("most categories shown when contexts is empty", () => {
        const allCategories = Object.values(CompletionCategory);
        for (const cat of allCategories) {
            if (cat === CompletionCategory.FuncVarKeyword) continue;
            const items = [createItem("TEST", cat)];
            const filtered = filterItemsByContext(items, []);
            expect(filtered, `${cat} should be shown in general context`).toHaveLength(1);
        }
    });

    it("FuncVarKeyword excluded from general context", () => {
        const items = [createItem("INT_VAR", CompletionCategory.FuncVarKeyword)];
        const filtered = filterItemsByContext(items, []);
        expect(filtered).toHaveLength(0);
    });

    it("FuncVarKeyword hidden in incomplete code without function context", () => {
        // Broken code — tree-sitter can't detect function call, contexts are empty
        const contexts = getContexts(`LAF\n|`);
        const items = [
            createItem("INT_VAR", CompletionCategory.FuncVarKeyword),
            createItem("STR_VAR", CompletionCategory.FuncVarKeyword),
        ];
        const filtered = filterItemsByContext(items, contexts);
        // FuncVarKeyword is context-required — hidden when no context detected
        expect(filtered).toHaveLength(0);
    });

    it("FuncVarKeyword shown after function name in parseable call", () => {
        // Incomplete but parseable — tree-sitter detects function call
        const contexts = getContexts(`LAF func | END`);
        const items = [
            createItem("INT_VAR", CompletionCategory.FuncVarKeyword),
            createItem("STR_VAR", CompletionCategory.FuncVarKeyword),
        ];
        const filtered = filterItemsByContext(items, contexts);
        expect(filtered).toHaveLength(2);
    });

    it("FuncVarKeyword shown in incomplete LAF without END (text fallback)", () => {
        // No END — tree-sitter can't parse function call, text fallback detects param position
        const contexts = getContexts(`LAF func |`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
        const items = [
            createItem("INT_VAR", CompletionCategory.FuncVarKeyword),
            createItem("STR_VAR", CompletionCategory.FuncVarKeyword),
        ];
        const filtered = filterItemsByContext(items, contexts);
        expect(filtered).toHaveLength(2);
    });

    it("FuncVarKeyword shown in incomplete LPF without END (text fallback)", () => {
        const contexts = getContexts(`LPF func |`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
        const items = [
            createItem("INT_VAR", CompletionCategory.FuncVarKeyword),
            createItem("STR_VAR", CompletionCategory.FuncVarKeyword),
        ];
        const filtered = filterItemsByContext(items, contexts);
        expect(filtered).toHaveLength(2);
    });

    it("items without category shown in any context", () => {
        const item: Tp2CompletionItem = { label: "local_var", kind: CompletionItemKind.Variable };
        expect(filterItemsByContext([item], [])).toHaveLength(1);
        expect(filterItemsByContext([item], [CompletionContext.LafName])).toHaveLength(1);
        expect(filterItemsByContext([item], [CompletionContext.FuncParamName])).toHaveLength(1);
    });
});

// =========================================================================
// Value Modifier Categories
// =========================================================================
describe("value modifier exclusions", () => {
    const modifierCategories = [
        CompletionCategory.OptGlob,
        CompletionCategory.OptCase,
        CompletionCategory.OptExact,
        CompletionCategory.Caching,
        CompletionCategory.ArraySortType,
    ];

    for (const category of modifierCategories) {
        it(`${category} shown in general context`, () => {
            const items = [createItem("TEST", category)];
            expect(filterItemsByContext(items, [])).toHaveLength(1);
        });

        it(`${category} shown in FuncParamValue`, () => {
            expectFiltering(CompletionContext.FuncParamValue, category, true);
        });

        it(`${category} hidden in FuncParamName`, () => {
            expectFiltering(CompletionContext.FuncParamName, category, false);
        });

        it(`${category} hidden in all name contexts`, () => {
            expectFiltering(CompletionContext.LafName, category, false);
            expectFiltering(CompletionContext.LpfName, category, false);
            expectFiltering(CompletionContext.LamName, category, false);
            expectFiltering(CompletionContext.LpmName, category, false);
        });
    }
});
