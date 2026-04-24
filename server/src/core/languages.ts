/**
 * Typed language registry.
 * Single source of truth for all language IDs used in the extension.
 * Language IDs must match those defined in package.json contributes.languages.
 */

// Fallout languages
export const LANG_FALLOUT_SSL = "fallout-ssl" as const;
export const EXT_FALLOUT_SSL = ".ssl" as const;
/** SSL header file extensions for file watching */
const EXT_FALLOUT_SSL_HEADERS = [".h"] as const;
/** All SSL file extensions (headers + source) for workspace-wide features */
export const EXT_FALLOUT_SSL_ALL = [...EXT_FALLOUT_SSL_HEADERS, EXT_FALLOUT_SSL] as const;
export const LANG_FALLOUT_SSL_TOOLTIP = "fallout-ssl-tooltip" as const;
export const LANG_FALLOUT_WORLDMAP_TXT = "fallout-worldmap-txt" as const;
export const LANG_FALLOUT_MSG = "fallout-msg" as const;
export const EXT_FALLOUT_MSG = ".msg" as const;

// TypeScript-based languages (TSSL, TBAF, TD)
// These use "typescript" langId but are identified by file extension
export const LANG_TYPESCRIPT = "typescript" as const;
export const EXT_TSSL = ".tssl" as const;
export const EXT_TBAF = ".tbaf" as const;
export const EXT_TD = ".td" as const;

// WeiDU languages
export const LANG_WEIDU_TP2 = "weidu-tp2" as const;
/** TP2 file extensions (.tph = headers with shareable functions/macros) */
export const EXT_WEIDU_TP2 = [".tph", ".tpa", ".tpp", ".tp2"] as const;
export const LANG_WEIDU_TP2_TOOLTIP = "weidu-tp2-tooltip" as const;
export const LANG_WEIDU_BAF = "weidu-baf" as const;
export const EXT_WEIDU_BAF = ".baf" as const;
export const LANG_WEIDU_D = "weidu-d" as const;
export const EXT_WEIDU_D = ".d" as const;
export const LANG_WEIDU_D_TOOLTIP = "weidu-d-tooltip" as const;
export const LANG_WEIDU_SLB = "weidu-slb" as const;
export const LANG_WEIDU_SSL = "weidu-ssl" as const;
export const LANG_WEIDU_LOG = "weidu-log" as const;

// Infinity Engine languages
export const LANG_INFINITY_2DA = "infinity-2da" as const;
export const EXT_INFINITY_2DA = ".2da" as const;
export const LANG_WEIDU_TRA = "weidu-tra" as const;
export const EXT_WEIDU_TRA = ".tra" as const;

// Fallout scripts list
export const LANG_FALLOUT_SCRIPTS_LST = "fallout-scripts-lst" as const;
/** Matched by exact filename rather than extension. Used for file discovery in CLI. */
export const FILENAME_FALLOUT_SCRIPTS_LST = "scripts.lst" as const;

/**
 * Languages that support .tra translation references (@123 style).
 */
export const TRA_LANGUAGES: string[] = [
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TP2,
    LANG_TYPESCRIPT, // TBAF uses .tra references
];

/**
 * Languages that contain translation strings (msg/tra files).
 */
export const TRANSLATION_FILE_LANGUAGES: string[] = [LANG_FALLOUT_MSG, LANG_WEIDU_TRA];

/**
 * Languages that show .msg file references (Fallout style: mstr(123), NOption(123)).
 */
export const MSG_LANGUAGES: string[] = [
    LANG_FALLOUT_SSL,
    LANG_TYPESCRIPT, // TSSL uses .msg references
];

/**
 * File extensions of consumer files that reference .tra entries.
 * Single source of truth for the extension-to-traExt mapping for TRA consumers.
 * Used by the reverse index to discover which files may contain @123 or tra(123) references.
 */
export const CONSUMER_EXTENSIONS_TRA = [
    ...EXT_WEIDU_TP2.map((e) => e.slice(1)),
    EXT_WEIDU_D.slice(1),
    EXT_WEIDU_BAF.slice(1),
    EXT_TBAF.slice(1),
    EXT_TD.slice(1),
] as const;

/**
 * File extensions of consumer files that reference .msg entries.
 * Single source of truth for the extension-to-traExt mapping for MSG consumers.
 * Used by the reverse index to discover which files may contain mstr(123) etc. references.
 */
export const CONSUMER_EXTENSIONS_MSG = [EXT_FALLOUT_SSL.slice(1), "h", EXT_TSSL.slice(1)] as const;
