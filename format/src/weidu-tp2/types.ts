/**
 * Types, interfaces, and constants for WeiDU TP2 formatting.
 */

// ============================================
// Public types
// ============================================

// Shared format-pipeline types/helpers live in ../format-types; re-export so
// TP2 sibling modules keep importing them from "./types" and the public index
// keeps re-exporting DEFAULT_OPTIONS as weiduTp2DefaultOptions.
export { type FormatOptions, DEFAULT_OPTIONS, type FormatResult, throwFormatError } from "../format-types";

// TP2-specific context shape (carries indentSize for nested alignment).
export interface FormatContext {
    indent: string;
    lineLimit: number;
    indentSize: number;
}

// ============================================
// Internal constants
// ============================================

export const INLINE_COMMENT_SPACING = "  ";

// ============================================
// Keyword constants
// ============================================

export const KW_BEGIN = "BEGIN";
export const KW_END = "END";
export const KW_ELSE = "ELSE";
export const KW_THEN = "THEN";
export const KW_WITH = "WITH";
export const KW_DEFAULT = "DEFAULT";
export const KW_IN = "IN";
export const KW_ALWAYS = "ALWAYS";
export const KW_QUICK_MENU = "QUICK_MENU";
export const KW_ALWAYS_ASK = "ALWAYS_ASK";
export const KW_BUT_ONLY = "BUT_ONLY";
export const KW_BUT_ONLY_IF_IT_CHANGES = "BUT_ONLY_IF_IT_CHANGES";
export const KW_IF_EXISTS = "IF_EXISTS";
export const KW_UNLESS = "UNLESS";
export const KW_IF = "IF";
export const KW_FOR = "FOR";
export const KW_OUTER_FOR = "OUTER_FOR";
export const KW_LPF = "LPF";
export const KW_LAF = "LAF";
export const KW_LPM = "LPM";
export const KW_LAM = "LAM";
export const KW_PATCH_IF = "PATCH_IF";
export const KW_ACTION_IF = "ACTION_IF";
export const KW_PATCH_TRY = "PATCH_TRY";
export const KW_ACTION_TRY = "ACTION_TRY";

// ============================================
// Node type constants
// ============================================

/** Top-level directive types. */
export const TOP_LEVEL_DIRECTIVES = [
    "backup_directive",
    "author_directive",
    "support_directive",
    "version_flag",
    "readme_directive",
    "no_if_eval_bug_flag",
    "auto_eval_strings_flag",
    "allow_missing_directive",
    "language_directive",
] as const;

/** FOR_EACH style loops with IN keyword. */
export const FOR_EACH_TYPES = [
    "action_for_each",
    "action_php_each",
    "action_bash_for",
    "patch_bash_for",
    "patch_for_each",
    "patch_php_each",
] as const;

// ============================================
// Node type string constants
// ============================================

export const NODE_PATCH_TRY = "patch_try";
export const NODE_ACTION_TRY = "action_try";
export const NODE_INNER_PATCH = "inner_patch";
export const NODE_INNER_PATCH_SAVE = "inner_patch_save";
export const NODE_INNER_PATCH_FILE = "inner_patch_file";
export const NODE_REPLACE_BCS_BLOCK = "patch_replace_bcs_block";
export const NODE_INNER_ACTION = "inner_action";
export const NODE_COMPONENT = "component";
export const NODE_ALWAYS_BLOCK = "always_block";
export const NODE_PATCH_FILE = "patch_file";
export const NODE_INLINED_FILE = "inlined_file";
export const NODE_MATCH_CASE = "match_case";
export const NODE_ACTION_MATCH_CASE = "action_match_case";
export const NODE_REQUIRE_PREDICATE_ACTION = "action_require_predicate";

/** Control flow types (IF, MATCH, TRY, WHILE, etc.). */
export const CONTROL_FLOW_TYPES = [
    "action_if",
    "action_match",
    "action_try",
    "outer_for",
    "outer_while",
    "patch_if",
    "patch_match",
    "patch_try",
    "patch_for",
    "patch_while",
    "patch_with_scope",
    "action_alter_tlk_list",
    // Array definitions with BEGIN...END body
    "action_define_array",
    "action_define_associative_array",
    "patch_define_array",
    "patch_define_associative_array",
    // OUTER_* with BEGIN...END body
    "action_outer_patch",
    "action_outer_patch_save",
    "action_outer_inner_patch",
    "action_outer_inner_patch_save",
    // Patches with BEGIN...END body
    "patch_decompile_and_patch",
    "patch_replace_evaluate",
    // Actions with BEGIN...END body
    "action_with_tra",
    "action_with_scope",
    "action_make_biff",
    // FOR_EACH types
    ...FOR_EACH_TYPES,
] as const;

/** COPY-style action types. */
export const COPY_ACTION_TYPES = [
    "action_copy",
    "action_copy_existing",
    "action_copy_existing_regexp",
    "action_copy_random",
    "action_copy_large",
    "action_copy_kit",
    "action_copy_2da",
    "action_copy_all_gam_files",
] as const;

/** Function/macro definition types. */
export const FUNCTION_DEF_TYPES = [
    "action_define_function",
    "action_define_patch_function",
    "action_define_dimorphic_function",
    "action_define_macro",
    "action_define_patch_macro",
] as const;

/** Function/macro call types. */
export const FUNCTION_CALL_TYPES = [
    "action_launch_function",
    "action_launch_macro",
    "patch_launch_function",
    "patch_launch_macro",
] as const;

// ============================================
// Collected item types for aligned output
// ============================================

// ============================================
// Collected item type enum
// ============================================

/** Type discriminator for collected items. */
export enum CollectedItemType {
    Assignment = "assignment",
    Comment = "comment",
}

/** Collected assignment for aligned output. */
interface AssignmentItem {
    type: CollectedItemType.Assignment;
    name: string;
    value: string;
    endRow: number;
}

/** Collected comment for aligned output. */
interface CommentItem {
    type: CollectedItemType.Comment;
    text: string;
    startRow: number;
    endRow: number;
}

/** Discriminated union for collected items. */
export type CollectedItem = AssignmentItem | CommentItem;

// ============================================
// Condition formatting types
// ============================================

/** Operand with optional preceding operator (OR/AND). */
export interface ConditionOperand {
    operator: string | null; // null for first operand, "OR"/"AND" for subsequent
    text: string;
    /** Where the operand ends, used to match it with a comment written after it. */
    endRow: number;
    endColumn: number;
}
