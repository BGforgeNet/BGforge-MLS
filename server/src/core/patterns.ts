/**
 * Centralized regex patterns for translation references.
 * Single source of truth for all translation-related patterns.
 */

// =============================================================================
// MSG patterns (Fallout SSL, TSSL)
// Matches: mstr(123), NOption(123), display_mstr(123), etc.
// =============================================================================

/** MSG function names that take a translation reference as first argument */
const MSG_FUNCTIONS = [
    "Reply",
    "NOption",
    "GOption",
    "BOption",
    "mstr",
    "display_mstr",
    "floater",
    "floater_rand",
    "NLowOption",
    "BLowOption",
    "GLowOption",
    "GMessage",
    "NMessage",
    "BMessage",
    "CompOption",
] as const;

const msgFunctionsPattern = MSG_FUNCTIONS.join("|");

/** Matches MSG reference for hover detection: "mstr(123" or "NOption(123" */
export const REGEX_MSG_HOVER = new RegExp(`^(${msgFunctionsPattern})\\((\\d+)$`);

/** Matches MSG reference in text for inlay hints (global) */
export const REGEX_MSG_INLAY = new RegExp(`(${msgFunctionsPattern})\\((\\d+)`, "g");

/** Matches floater_rand() MSG references with two translation IDs. */
export const REGEX_MSG_INLAY_FLOATER_RAND = /floater_rand\((\d+)\s*,\s*(\d+)/g;

// =============================================================================
// TRA patterns (WeiDU: baf, d, tp2, etc.)
// Matches: @123
// =============================================================================

/** Matches TRA reference for hover detection: "@123" */
export const REGEX_TRA_HOVER = /^@[0-9]+$/;

/** Matches TRA reference in text for inlay hints (global) */
export const REGEX_TRA_INLAY = /@(\d+)/g;

// =============================================================================
// Transpiler TRA patterns (TBAF and TD)
// Both use tra(123) syntax.
// =============================================================================

/** Matches tra(123) reference for hover detection */
export const REGEX_TRANSPILER_TRA_HOVER = /^tra\((\d+)\)$/;

/** Matches tra(123) reference in text for inlay hints (global) */
export const REGEX_TRANSPILER_TRA_INLAY = /\btra\((\d+)\)/g;

// =============================================================================
// Reference-scanning patterns (for "Find References" from tra/msg files)
// These produce a match per entry number, used to locate all usages in consumer files.
// =============================================================================

/**
 * Builds a regex to find references to a specific TRA entry number.
 * Matches both @{num} (native WeiDU) and tra({num}) (transpiler) patterns.
 * The number must be followed by a non-digit to avoid partial matches (e.g., @12 in @123).
 */
export function REGEX_TRA_REF(entryNum: string): RegExp {
    return new RegExp(`(?:@${entryNum}(?!\\d)|\\btra\\(${entryNum}\\))`, "g");
}

/**
 * Builds a regex to find references to a specific MSG entry number.
 * Matches all MSG function patterns: mstr(num), NOption(num), etc.
 * Also matches floater_rand where the entry appears as the second argument.
 * Combined into a single alternation for a single-pass scan.
 */
export function REGEX_MSG_REF(entryNum: string): RegExp {
    return new RegExp(
        `(?:${msgFunctionsPattern})\\(${entryNum}(?!\\d)|floater_rand\\(\\d+\\s*,\\s*${entryNum}(?!\\d)`,
        "g",
    );
}

// =============================================================================
// @tra comment pattern
// Matches: /** @tra filename.msg */ or /** @tra filename.tra */
// =============================================================================

/** Extracts full filename from @tra comment: "/** @tra test.msg *‌/" => "test.msg" */
export const REGEX_TRA_COMMENT = /^\/\*\* @tra ((\w+)\.(tra|msg)) \*\//;

/** Extracts just the extension from @tra comment: "/** @tra test.msg *‌/" => "msg" */
export const REGEX_TRA_COMMENT_EXT = /^\/\*\* @tra \w+\.(tra|msg) \*\//;
