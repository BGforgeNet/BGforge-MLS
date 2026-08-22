/**
 * Server-internal language registry.
 *
 * Re-exports the cross-package registry from shared/languages.ts (file
 * extensions and language IDs that @bgforge/format and the transpiler
 * packages also need) and adds server-only groupings used by the reverse
 * index, translation pipeline, and message-references logic.
 */

export {
    LANG_FALLOUT_SSL,
    LANG_FALLOUT_SSL_TOOLTIP,
    LANG_FALLOUT_WORLDMAP_TXT,
    LANG_FALLOUT_MSG,
    LANG_TYPESCRIPT,
    LANG_WEIDU_TP2,
    LANG_WEIDU_TP2_TOOLTIP,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_D_TOOLTIP,
    LANG_WEIDU_SLB,
    LANG_WEIDU_SSL,
    LANG_WEIDU_LOG,
    LANG_INFINITY_2DA,
    LANG_WEIDU_TRA,
    LANG_FALLOUT_SCRIPTS_LST,
    EXT_FALLOUT_SSL_ALL,
    EXT_TSSL,
    EXT_TBAF,
    EXT_TD,
    EXT_WEIDU_TP2,
    EXT_WEIDU_D,
    CONSUMER_EXTENSIONS_TRA,
    CONSUMER_EXTENSIONS_MSG,
} from "../../../shared/languages";

import {
    LANG_FALLOUT_MSG,
    LANG_FALLOUT_SSL,
    LANG_TYPESCRIPT,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TP2,
    LANG_WEIDU_TRA,
} from "../../../shared/languages";

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
 * Characters beyond `\w` that a language's grammar admits inside a name, for the cursor word-scan
 * in cursor-utils.ts. BAF IDS names carry `-` (KUO-TOA), TP2 and D macro and state names carry `#`
 * (tb#factorial, RR#ZA00), and D state labels also carry `.` and `-` (KHPC1.1, Quayle_Shar-Teel_1).
 *
 * Per-language rather than global because the same character is an operator elsewhere: widening the
 * scan everywhere would return "a-b" for SSL subtraction. Kept in step with the grammars by
 * server/test/core/identifier-extra-chars.test.ts, which asks each parser what it actually accepts.
 */
export const IDENTIFIER_EXTRA_CHARS: Readonly<Record<string, string>> = {
    [LANG_WEIDU_BAF]: "-",
    [LANG_WEIDU_TP2]: "#-",
    [LANG_WEIDU_D]: "#.-",
};
