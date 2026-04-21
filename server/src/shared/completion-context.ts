/**
 * Generic framework for context-aware completion filtering.
 *
 * Provides type-safe utilities for filtering completion items based on cursor context.
 * Language-specific implementations extend the base types and provide their own
 * context detection logic.
 *
 * Key concepts:
 * - CompletionContext: String union of valid contexts for a language
 * - CompletionCategory: Category annotation on completion items
 * - Context detection: Language-specific logic to determine cursor context
 * - Filtering: Generic logic to filter items based on category and context
 */

import { CompletionItem } from "vscode-languageserver/node";
import { WEIDU_TP2_STANZAS } from "../../../shared/stanza-names";

/**
 * Valid completion item categories for WeiDU TP2.
 * Categories determine where completions should appear based on context.
 *
 * Split of responsibility:
 * - YAML stanza-backed category strings come from shared/stanza-names.ts.
 * - Non-stanza categories ("action", "patch", "vars", etc.) stay local here
 *   because they are runtime filtering buckets, not YAML stanza identifiers.
 *
 * When adding or renaming a stanza-backed TP2 category, update both this file
 * and shared/stanza-names.ts together.
 *
 * Category groups:
 * - Structural: Prologue, Flag, Component, ComponentFlag, Language - File/component structure directives
 * - Commands: Action, Patch - Context-specific statements (value positions)
 * - Functions: ActionFunctions, PatchFunctions - User-defined functions
 * - Values: Constants, Vars, Value, When, OptGlob, OptCase, OptExact, Caching, ArraySortType
 * - Parameters: FuncVarKeyword - INT_VAR, STR_VAR, RET, RET_ARRAY keywords
 * - Documentation: Jsdoc - JSDoc tags and types
 *
 * @see CATEGORY_EXCLUSIONS in filter.ts for exclusion rules per category
 */
export const CompletionCategory = {
    // Structural directives
    Prologue: "prologue",
    Flag: "flag",
    Component: WEIDU_TP2_STANZAS.component,
    ComponentFlag: WEIDU_TP2_STANZAS.component_flag,
    Language: "language",
    // Action context (value position)
    Action: "action",
    // Patch context (value position)
    Patch: "patch",
    // Value items (not commands)
    Constants: "constants",
    Vars: "vars",
    Value: "value",
    When: "when",
    OptGlob: WEIDU_TP2_STANZAS.opt_glob,
    OptCase: WEIDU_TP2_STANZAS.opt_case,
    OptExact: WEIDU_TP2_STANZAS.opt_exact,
    Caching: "caching",
    ArraySortType: WEIDU_TP2_STANZAS.array_sort_type,
    // Function parameter keywords (INT_VAR, STR_VAR, RET, RET_ARRAY)
    FuncVarKeyword: WEIDU_TP2_STANZAS.func_var_keyword,
    // Function libraries
    ActionFunctions: WEIDU_TP2_STANZAS.action_functions,
    PatchFunctions: WEIDU_TP2_STANZAS.patch_functions,
    DimorphicFunctions: WEIDU_TP2_STANZAS.dimorphic_functions,
    // Macro libraries
    ActionMacros: WEIDU_TP2_STANZAS.action_macros,
    PatchMacros: WEIDU_TP2_STANZAS.patch_macros,
    // JSDoc tags and types
    Jsdoc: "jsdoc",
} as const;

export type CompletionCategory = (typeof CompletionCategory)[keyof typeof CompletionCategory];

/**
 * Extended completion item with optional category metadata.
 * The category field is added by generate-data at build time.
 */
export interface CompletionItemWithCategory extends CompletionItem {
    /**
     * Category from YAML data file (e.g., "action", "patch", "flag").
     * Items without this field are shown in all contexts (e.g., local completions).
     */
    category?: CompletionCategory;
}

// ============================================
// UTF-8 Safe Position Utilities
// ============================================

/**
 * Convert line/character position to byte offset, handling UTF-8 properly.
 *
 * In LSP, positions use UTF-16 code units (JavaScript string indices).
 * Tree-sitter uses byte offsets in UTF-8.
 *
 * @param text - Document text
 * @param line - 0-based line number
 * @param character - 0-based UTF-16 code unit offset within line
 * @returns Byte offset in UTF-8 encoding
 */
export function getUtf8ByteOffset(text: string, line: number, character: number): number {
    let currentLine = 0;
    let lineStart = 0;

    // Find the start of the target line
    for (let i = 0; i < text.length; i++) {
        if (currentLine === line) {
            lineStart = i;
            break;
        }
        if (text[i] === "\n") {
            currentLine++;
        }
    }

    // Handle case where line is beyond end of document
    if (currentLine < line) {
        return Buffer.byteLength(text, "utf8");
    }

    // Find the character position within the line
    // character is in UTF-16 code units (JS string indices)
    let charCount = 0;
    for (let i = lineStart; i < text.length; i++) {
        if (charCount === character) {
            // Return byte offset up to this position
            return Buffer.byteLength(text.substring(0, i), "utf8");
        }
        if (text[i] === "\n") {
            // Reached end of line before reaching character position
            // Return byte offset of newline plus remaining characters
            const lineEndOffset = Buffer.byteLength(text.substring(0, i), "utf8");
            return lineEndOffset + (character - charCount);
        }
        charCount++;
    }

    // Character is beyond end of document
    // Return byte offset of document end plus remaining characters
    const docEndOffset = Buffer.byteLength(text, "utf8");
    return docEndOffset + (character - charCount);
}
