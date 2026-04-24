/**
 * Canonical JSDoc type name lists for all supported languages.
 * Single source of truth for type names used in JSDoc annotations.
 *
 * These lists are validated against TextMate grammars by server/test/shared/type-sync.test.ts.
 *
 * SYNC: syntaxes/bgforge-mls-docstring.tmLanguage.yml (#type repository)
 * SYNC: syntaxes/fallout-ssl-tooltip.tmLanguage.yml (subset: JSDoc types only)
 * SYNC: syntaxes/weidu-tp2-tooltip.tmLanguage.yml (subset: JSDoc types only)
 *
 * For WeiDU type metadata (detail, INT_VAR/STR_VAR category), see weidu-types.ts.
 */

/** Type names available in Fallout SSL JSDoc annotations. */
export const FALLOUT_JSDOC_TYPE_NAMES: readonly string[] = [
    "array",
    "any",
    "bit",
    "bool",
    "float",
    "int",
    "list",
    "map",
    "mixed",
    "ObjectPtr",
    "string",
] as const;

/** Type names available in WeiDU JSDoc annotations. Keys must match WEIDU_JSDOC_TYPES in weidu-types.ts. */
export const WEIDU_JSDOC_TYPE_NAMES: readonly string[] = [
    "array",
    "bit",
    "bool",
    "filename",
    "ids",
    "int",
    "list",
    "map",
    "resref",
    "string",
] as const;

/** Custom type names shared across languages (not engine-specific). Subset of the above. */
export const CUSTOM_JSDOC_TYPE_NAMES: readonly string[] = ["list", "map"] as const;

/** All JSDoc type names across all languages, deduplicated and sorted. Used for brace-less type disambiguation. */
export const ALL_JSDOC_TYPE_NAMES: readonly string[] = [
    ...new Set([...FALLOUT_JSDOC_TYPE_NAMES, ...WEIDU_JSDOC_TYPE_NAMES, ...CUSTOM_JSDOC_TYPE_NAMES]),
].sort() as readonly string[];

/** Regex alternation string for all JSDoc types, for use in patterns. */
export const JSDOC_TYPE_PATTERN = ALL_JSDOC_TYPE_NAMES.join("|");

// ============================================
// Canonical JSDoc tag names
// ============================================
// SYNC: shared/jsdoc.ts (parser patterns)
// SYNC: shared/jsdoc-completions.ts (completion items)
// SYNC: syntaxes/bgforge-mls-docstring.tmLanguage.yml (grammar patterns)
// Validated by: server/test/shared/type-sync.test.ts

/** Tags for parameter documentation. First entry is the primary form. */
export const JSDOC_PARAM_TAGS = ["param", "arg"] as const;

/** Tags for return documentation. First entry is the primary form. */
export const JSDOC_RETURN_TAGS = ["ret", "return", "returns"] as const;

/** Tags without aliases. */
export const JSDOC_STANDALONE_TAGS = ["type", "deprecated"] as const;

/** All JSDoc tag names (without @ prefix), sorted. */
export const ALL_JSDOC_TAG_NAMES: readonly string[] = [
    ...JSDOC_PARAM_TAGS,
    ...JSDOC_RETURN_TAGS,
    ...JSDOC_STANDALONE_TAGS,
].sort();
