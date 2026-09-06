/**
 * How a language compares identifiers.
 *
 * The symbol and reference indexes are one implementation serving several languages, and those languages
 * disagree: Fallout SSL binds procedures, variables and builtins case-insensitively (see
 * `fallout-ssl-names.ts` for how that was established), while WeiDU D state labels and tp2 variable names
 * are matched exactly - `~Gerde~` and `~gerde~` are different labels to WeiDU. So the fold is a property of
 * the language, declared once and carried by the index, rather than a decision each call site repeats.
 */

import { LANG_FALLOUT_SSL, LANG_WEIDU_D, LANG_WEIDU_TP2 } from "./languages";

/** Whether identifiers of a language fold to one key or compare exactly. */
export type NameCase = "fold" | "exact";

/**
 * Per-language rule for the languages that index user-defined symbols. Exact is the default for anything
 * absent, so a language that has not been considered fails toward reporting too little rather than
 * conflating two distinct names.
 *
 * WeiDU BAF is deliberately absent: it defines no named constructs, so it puts no user-defined symbol in
 * these indexes at all. Its engine trigger/action vocabulary is matched case-insensitively, but that is a
 * static-completion concern, not an index key.
 */
const NAME_CASE_BY_LANGUAGE: Readonly<Record<string, NameCase>> = {
    [LANG_FALLOUT_SSL]: "fold",
    [LANG_WEIDU_D]: "exact",
    [LANG_WEIDU_TP2]: "exact",
};

/** How `languageId` compares identifiers. Unlisted languages compare exactly. */
export function nameCaseFor(languageId: string): NameCase {
    return NAME_CASE_BY_LANGUAGE[languageId] ?? "exact";
}

/**
 * The index key for `name` under `nameCase`. Locale-independent: `toLowerCase` never applies Turkish-I.
 *
 * Only the KEY folds - stored names keep the spelling their source used, because that is what a hover title
 * or an outline entry displays.
 */
export function nameCaseKey(name: string, nameCase: NameCase): string {
    return nameCase === "fold" ? name.toLowerCase() : name;
}
