/**
 * Tests for weidu-tp2/completion/filter.ts - Completion context filtering rules.
 * Validates that CATEGORY_EXCLUSIONS use only valid contexts and that
 * each category is correctly included/excluded per context.
 */

import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import { CompletionCategory, CompletionContext, type Tp2CompletionItem } from "../../src/weidu-tp2/completion/types";
import { CATEGORY_EXCLUSIONS, VALID_CONTEXTS, filterItemsByContext } from "../../src/weidu-tp2/completion/filter";

describe("completion-filter", () => {
    // =========================================================================
    // Exclusion rule validation
    // =========================================================================
    describe("CATEGORY_EXCLUSIONS validation", () => {
        it("should only contain valid CompletionContext values in exclusions", () => {
            for (const [category, exclusions] of Object.entries(CATEGORY_EXCLUSIONS)) {
                for (const ctx of exclusions!) {
                    expect(
                        VALID_CONTEXTS.has(ctx),
                        `Invalid context "${ctx}" in exclusion for category "${category}"`,
                    ).toBe(true);
                }
            }
        });

        it("should only use valid CompletionCategory keys", () => {
            const validCategories = new Set(Object.values(CompletionCategory));
            for (const key of Object.keys(CATEGORY_EXCLUSIONS)) {
                expect(
                    validCategories.has(key as CompletionCategory),
                    `Invalid category key "${key}" in CATEGORY_EXCLUSIONS`,
                ).toBe(true);
            }
        });
    });

    // =========================================================================
    // DimorphicFunctions category rules
    // =========================================================================
    describe("DimorphicFunctions exclusions", () => {
        const exclusions = CATEGORY_EXCLUSIONS[CompletionCategory.DimorphicFunctions]!;

        it("should be included in lafName context", () => {
            expect(exclusions).not.toContain(CompletionContext.LafName);
        });

        it("should be included in lpfName context", () => {
            expect(exclusions).not.toContain(CompletionContext.LpfName);
        });

        it("should be excluded from lamName context", () => {
            expect(exclusions).toContain(CompletionContext.LamName);
        });

        it("should be excluded from lpmName context", () => {
            expect(exclusions).toContain(CompletionContext.LpmName);
        });
    });

    // =========================================================================
    // ActionMacros category rules
    // =========================================================================
    describe("ActionMacros exclusions", () => {
        const exclusions = CATEGORY_EXCLUSIONS[CompletionCategory.ActionMacros]!;

        it("should be included in lamName context", () => {
            expect(exclusions).not.toContain(CompletionContext.LamName);
        });

        it("should be excluded from lafName context", () => {
            expect(exclusions).toContain(CompletionContext.LafName);
        });

        it("should be excluded from lpfName context", () => {
            expect(exclusions).toContain(CompletionContext.LpfName);
        });

        it("should be excluded from lpmName context", () => {
            expect(exclusions).toContain(CompletionContext.LpmName);
        });
    });

    // =========================================================================
    // PatchMacros category rules
    // =========================================================================
    describe("PatchMacros exclusions", () => {
        const exclusions = CATEGORY_EXCLUSIONS[CompletionCategory.PatchMacros]!;

        it("should be included in lpmName context", () => {
            expect(exclusions).not.toContain(CompletionContext.LpmName);
        });

        it("should be excluded from lafName context", () => {
            expect(exclusions).toContain(CompletionContext.LafName);
        });

        it("should be excluded from lpfName context", () => {
            expect(exclusions).toContain(CompletionContext.LpfName);
        });

        it("should be excluded from lamName context", () => {
            expect(exclusions).toContain(CompletionContext.LamName);
        });
    });

    // =========================================================================
    // Structural categories (excluded from name + param contexts)
    // =========================================================================
    describe("structural category exclusions", () => {
        const structuralCategories = [
            CompletionCategory.Prologue,
            CompletionCategory.Flag,
            CompletionCategory.Component,
            CompletionCategory.ComponentFlag,
            CompletionCategory.Language,
        ];

        for (const category of structuralCategories) {
            describe(`${category} exclusions`, () => {
                const exclusions = CATEGORY_EXCLUSIONS[category]!;

                it("should be excluded from all name contexts", () => {
                    expect(exclusions).toContain(CompletionContext.LafName);
                    expect(exclusions).toContain(CompletionContext.LpfName);
                    expect(exclusions).toContain(CompletionContext.LamName);
                    expect(exclusions).toContain(CompletionContext.LpmName);
                });

                it("should be excluded from both param contexts", () => {
                    expect(exclusions).toContain(CompletionContext.FuncParamName);
                    expect(exclusions).toContain(CompletionContext.FuncParamValue);
                });
            });
        }
    });

    // =========================================================================
    // Value modifier categories
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
            describe(`${category} exclusions`, () => {
                const exclusions = CATEGORY_EXCLUSIONS[category]!;

                it("should be excluded from all name contexts", () => {
                    expect(exclusions).toContain(CompletionContext.LafName);
                    expect(exclusions).toContain(CompletionContext.LpfName);
                    expect(exclusions).toContain(CompletionContext.LamName);
                    expect(exclusions).toContain(CompletionContext.LpmName);
                });

                it("should be excluded from funcParamName context", () => {
                    expect(exclusions).toContain(CompletionContext.FuncParamName);
                });

                it("should be included in funcParamValue context", () => {
                    expect(exclusions).not.toContain(CompletionContext.FuncParamValue);
                });
            });
        }
    });

    // =========================================================================
    // Items without category
    // =========================================================================
    describe("items without category", () => {
        it("should pass through filter in any context", () => {
            const items: Tp2CompletionItem[] = [
                { label: "no_category_var", kind: CompletionItemKind.Variable },
                {
                    label: "with_category",
                    kind: CompletionItemKind.Function,
                    category: CompletionCategory.ActionFunctions,
                },
            ];
            const result = filterItemsByContext(items, [CompletionContext.LafName]);
            const labels = result.map((i) => i.label);
            expect(labels).toContain("no_category_var");
            expect(labels).toContain("with_category");
        });

        it("should pass through filter with empty contexts", () => {
            const items: Tp2CompletionItem[] = [{ label: "local_var", kind: CompletionItemKind.Variable }];
            const result = filterItemsByContext(items, []);
            expect(result).toHaveLength(1);
            expect(result[0]!.label).toBe("local_var");
        });
    });

    // =========================================================================
    // Empty contexts = no filtering (except restricted categories)
    // =========================================================================
    describe("empty contexts", () => {
        it("should show general items when contexts array is empty", () => {
            const items: Tp2CompletionItem[] = [
                createItem("ACTION_IF", CompletionCategory.Action),
                createItem("READ_LONG", CompletionCategory.Patch),
                createItem("my_func", CompletionCategory.ActionFunctions),
                createItem("BACKUP", CompletionCategory.Prologue),
            ];
            const result = filterItemsByContext(items, []);
            expect(result).toHaveLength(4);
        });

        it("should exclude FuncVarKeyword in general context", () => {
            const items: Tp2CompletionItem[] = [
                createItem("ACTION_IF", CompletionCategory.Action),
                createItem("INT_VAR", CompletionCategory.FuncVarKeyword),
            ];
            const result = filterItemsByContext(items, []);
            const labels = result.map((i) => i.label);
            expect(labels).toContain("ACTION_IF");
            expect(labels).not.toContain("INT_VAR");
        });
    });

    // =========================================================================
    // Permissive multi-context filtering
    // =========================================================================
    describe("permissive filtering", () => {
        it("item excluded by one context but allowed by another is shown", () => {
            // ActionFunctions excluded from LpfName, but allowed in LafName
            const items: Tp2CompletionItem[] = [createItem("my_func", CompletionCategory.ActionFunctions)];
            const result = filterItemsByContext(items, [CompletionContext.LafName, CompletionContext.LpfName]);
            expect(result).toHaveLength(1);
        });

        it("item excluded by all active contexts is hidden", () => {
            // ActionMacros excluded from both LafName and LpfName
            const items: Tp2CompletionItem[] = [createItem("my_macro", CompletionCategory.ActionMacros)];
            const result = filterItemsByContext(items, [CompletionContext.LafName, CompletionContext.LpfName]);
            expect(result).toHaveLength(0);
        });
    });
});

function createItem(label: string, category: CompletionCategory): Tp2CompletionItem {
    return { label, kind: CompletionItemKind.Keyword, category };
}
