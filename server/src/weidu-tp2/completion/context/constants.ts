/**
 * Module-level constants for TP2 completion context detection.
 * Contains RegExp patterns for declaration site detection and function call keywords.
 */

/** LAF/LPF/LAM/LPM keywords that indicate function/macro name position. */
export const FUNC_CALL_KEYWORDS =
    /^\s*(LAF|LPF|LAM|LPM|LAUNCH_ACTION_FUNCTION|LAUNCH_PATCH_FUNCTION|LAUNCH_ACTION_MACRO|LAUNCH_PATCH_MACRO)\s+\S*$/i;

/**
 * LAF/LPF keywords followed by a function name and whitespace — cursor is past the name,
 * in parameter position (INT_VAR/STR_VAR/RET). Used as text fallback when tree-sitter
 * can't parse incomplete function calls (e.g., no END yet).
 * Does not match LAM/LPM — macros have no parameters.
 */
export const FUNC_PARAM_KEYWORDS = /^\s*(?:LAF|LPF|LAUNCH_ACTION_FUNCTION|LAUNCH_PATCH_FUNCTION)\s+\S+\s+/i;

/**
 * Declaration site patterns: detect when the cursor is on a new symbol name being declared.
 * Split into two categories to enable different completion behavior:
 * - "assignment": variable SET/SPRINT - show local variable completions (for reassignment)
 * - "definition": function/macro/array/loop - suppress all completions (new unique name)
 *
 * Why regex instead of tree-sitter AST:
 * At declaration sites the user is mid-typing a new identifier (e.g. `OUTER_SET fo|`).
 * Tree-sitter cannot produce a valid declaration node for incomplete input — the grammar
 * requires both a name and a value (`OUTER_SET name = expr`), so partial input lands in
 * an ERROR node. An earlier attempt modified the grammar to make parts optional, but this
 * introduced unresolvable ambiguities (e.g. optional `BEGIN...END` on function definitions
 * conflicted with the `component` rule). This is a known tree-sitter limitation —
 * error recovery does not produce typed incomplete nodes, only ERROR nodes with no
 * reliable structure to match against (see https://github.com/tree-sitter/tree-sitter/issues/923).
 * Line-text regex is the fallback convention used throughout this codebase for similar
 * incomplete-input scenarios (see FUNC_CALL_KEYWORDS above).
 * See also: SSL_DECLARATION_SITE_PATTERN in fallout-ssl/completion-context.ts.
 */

/** Variable assignment keywords (SET/SPRINT) with optional EVAL/EVALUATE_BUFFER/GLOBAL modifier. */
export const ASSIGNMENT_SITE_PATTERN = new RegExp(
    "^\\s*(?:OUTER_)?(?:SET|SPRINT|TEXT_SPRINT)\\s+(?:(?:EVAL(?:UATE_BUFFER)?|GLOBAL)\\s+)?\\S*$",
    "i",
);

/** Definition keywords (function/macro/array/loop) where a new unique name is being declared. */
export const DEFINITION_SITE_PATTERN = new RegExp(
    "^\\s*(" +
        // Function/macro definitions
        "DEFINE_(?:ACTION|PATCH)_(?:FUNCTION|MACRO)\\s+|" +
        // Array definitions
        "(?:ACTION_)?DEFINE_(?:ASSOCIATIVE_)?ARRAY\\s+|" +
        // Loop variable bindings
        "(?:PATCH_|ACTION_)?(?:FOR_EACH|PHP_EACH)\\s+" +
        ")\\S*$",
    "i",
);
