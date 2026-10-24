/**
 * Shared types for WeiDU TP2 completion context detection and filtering.
 * Used by context.ts and filter.ts.
 */

import type { CallableContext } from "../../core/symbol";

/**
 * Parameter section types for WeiDU function calls.
 */
export enum ParamSection {
    IntVar = "INT_VAR",
    StrVar = "STR_VAR",
    Ret = "RET",
    RetArray = "RET_ARRAY",
}

/**
 * Enriched context for function parameter completion.
 * Contains function name, parameter section, and already-used params.
 */
export interface FuncParamsContext {
    functionName: string;
    /** Whether the call launches an action function (LAF) or a patch function (LPF). */
    callContext: CallableContext.Action | CallableContext.Patch;
    paramSection: ParamSection;
    usedParams: string[];
}

/**
 * Completion context types for filtering.
 *
 * Only two filtering concerns remain:
 * 1. Function name contexts (LAF/LPF/LAM/LPM) - restrict to matching callable type
 * 2. Function parameter contexts - INT_VAR/STR_VAR keywords only in param blocks
 *
 * All other positions use empty context array = no filtering (VSCode prefix matching
 * handles the rest).
 *
 * **Note on lafName/lpfName/lamName/lpmName:**
 * These contexts only allow corresponding callable names:
 * - lafName: action functions + dimorphic
 * - lpfName: patch functions + dimorphic
 * - lamName: action macros only
 * - lpmName: patch macros only
 *
 * **Note on funcParamName/funcParamValue:**
 * These contexts distinguish left and right sides of = in function parameters:
 * - funcParamName: parameter name position (left of = or no =)
 * - funcParamValue: parameter value position (right of =)
 */
export enum CompletionContext {
    LafName = "lafName",
    LpfName = "lpfName",
    LamName = "lamName",
    LpmName = "lpmName",
    FuncParamName = "funcParamName",
    FuncParamValue = "funcParamValue",
    Comment = "comment",
    Jsdoc = "jsdoc",
}

// Re-export CompletionCategory from shared for convenience
export { CompletionCategory } from "../../shared/completion-context";

import type { CompletionItemWithCategory } from "../../shared/completion-context";

/**
 * TP2 completion item with optional category for context filtering.
 * Items from YAML data and AST extraction have category set.
 * Items from external sources (local symbols, registry) may not.
 * The filter treats missing category as "show in all contexts".
 */
export type Tp2CompletionItem = CompletionItemWithCategory;
