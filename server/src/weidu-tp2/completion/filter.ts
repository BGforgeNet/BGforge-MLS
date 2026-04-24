/**
 * Completion item filtering based on context.
 *
 * Design: only two positions require filtering — all others show everything unfiltered
 * (VSCode's prefix matching handles the rest). This avoids context misdetection bugs
 * from tree-sitter error recovery in broken/incomplete code.
 *
 * Rule groups:
 * A) Name contexts (LAF/LPF/LAM/LPM name position): restrict to matching callable type.
 * B) Param contexts (INT_VAR/STR_VAR blocks): FuncVarKeyword only in FuncParamName.
 * C) Context-required categories: some categories (FuncVarKeyword) are suppressed in
 *    general context (empty array) because they are only meaningful inside function calls.
 *
 * Snippets are applied globally (not gated by context) — the snippet prefix is determined
 * from the symbol's own callable data (action/patch function/macro), not cursor position.
 * In name contexts, no prefix is added (user already typed LAF/LPF/etc).
 */

import type { CompletionItem } from "vscode-languageserver/node";
import { CompletionCategory, CompletionContext, type Tp2CompletionItem } from "./types";

/** Categories that require a specific context to appear (excluded from general/empty context). */
const CONTEXT_REQUIRED_CATEGORIES = new Set<CompletionCategory>([CompletionCategory.FuncVarKeyword]);

/** All name contexts (function/macro name positions). */
const ALL_NAME_CONTEXTS: CompletionContext[] = [
    CompletionContext.LafName,
    CompletionContext.LpfName,
    CompletionContext.LamName,
    CompletionContext.LpmName,
];

/**
 * Exclusion rules: category -> contexts where it should NOT appear.
 *
 * Group A - Name contexts: Only matching callable type in name positions.
 * Group B - Param contexts: non-callable categories excluded from param positions.
 *
 * Note: FuncVarKeyword is also excluded from general context (empty array) via
 * CONTEXT_REQUIRED_CATEGORIES, since INT_VAR/STR_VAR/RET/RET_ARRAY keywords are
 * only meaningful inside function call/definition parameter blocks.
 */
const CATEGORY_EXCLUSIONS: Partial<Record<CompletionCategory, CompletionContext[]>> = {
    // Group A: Callable type restrictions in name contexts
    // ActionFunctions: show in LafName + general, exclude from LpfName/LamName/LpmName
    [CompletionCategory.ActionFunctions]: [
        CompletionContext.LpfName,
        CompletionContext.LamName,
        CompletionContext.LpmName,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    // PatchFunctions: show in LpfName + general, exclude from LafName/LamName/LpmName
    [CompletionCategory.PatchFunctions]: [
        CompletionContext.LafName,
        CompletionContext.LamName,
        CompletionContext.LpmName,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    // ActionMacros: show in LamName + general, exclude from LafName/LpfName/LpmName
    [CompletionCategory.ActionMacros]: [
        CompletionContext.LafName,
        CompletionContext.LpfName,
        CompletionContext.LpmName,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    // PatchMacros: show in LpmName + general, exclude from LafName/LpfName/LamName
    [CompletionCategory.PatchMacros]: [
        CompletionContext.LafName,
        CompletionContext.LpfName,
        CompletionContext.LamName,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    // DimorphicFunctions: show in LafName + LpfName + general, exclude from LamName/LpmName
    [CompletionCategory.DimorphicFunctions]: [
        CompletionContext.LamName,
        CompletionContext.LpmName,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],

    // Non-callable categories: excluded from all name contexts
    [CompletionCategory.Prologue]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.Flag]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.Component]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.ComponentFlag]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.Language]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.Action]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.Patch]: [
        ...ALL_NAME_CONTEXTS,
        CompletionContext.FuncParamName,
        CompletionContext.FuncParamValue,
    ],
    [CompletionCategory.Constants]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.Vars]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.Value]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.When]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.OptGlob]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.OptCase]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.OptExact]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.Caching]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],
    [CompletionCategory.ArraySortType]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamName],

    // Group B: FuncVarKeyword only in FuncParamName (excluded from everything else)
    [CompletionCategory.FuncVarKeyword]: [...ALL_NAME_CONTEXTS, CompletionContext.FuncParamValue],
};

/**
 * Contexts referenced in CATEGORY_EXCLUSIONS — used by tests to validate rule consistency.
 * Comment and Jsdoc are intentionally absent: they are early-exit gates in provider.ts
 * (returning [] or JSDoc items) and never reach filterItemsByContext.
 */
const VALID_CONTEXTS = new Set<CompletionContext>([
    CompletionContext.LafName,
    CompletionContext.LpfName,
    CompletionContext.LamName,
    CompletionContext.LpmName,
    CompletionContext.FuncParamName,
    CompletionContext.FuncParamValue,
]);

// Exported for test access.
export { CATEGORY_EXCLUSIONS, VALID_CONTEXTS };

/**
 * Filter completion items based on exclusion rules.
 *
 * - Empty contexts: show everything except context-required categories (e.g. FuncVarKeyword).
 * - With contexts: exclude item only if ALL active contexts exclude it (permissive —
 *   if even one context allows the item, it is shown).
 */
export function filterItemsByContext(items: Tp2CompletionItem[], contexts: CompletionContext[]): CompletionItem[] {
    // No contexts = show everything except context-required categories
    if (contexts.length === 0) {
        return items.filter((item) => item.category === undefined || !CONTEXT_REQUIRED_CATEGORIES.has(item.category));
    }

    return items.filter((item) => !isItemExcluded(item, contexts));
}

/**
 * Check if item should be excluded based on active contexts.
 * Returns true only if ALL active contexts exclude this item's category.
 *
 * Permissive: if even one context allows the item, show it.
 */
function isItemExcluded(item: Tp2CompletionItem, contexts: CompletionContext[]): boolean {
    if (contexts.length === 0) {
        return false;
    }

    if (item.category === undefined) {
        return false;
    }

    const exclusions = CATEGORY_EXCLUSIONS[item.category];
    if (!exclusions || exclusions.length === 0) {
        return false;
    }

    return contexts.every((ctx) => exclusions.includes(ctx));
}
