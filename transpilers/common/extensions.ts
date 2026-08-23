/**
 * Transpiler file extension constants.
 *
 * Re-exported from shared/languages.ts (the authoritative cross-package registry) so the transpiler
 * workspace reaches one local module rather than each file reaching across on its own. `.tssl` is not
 * here: its compiler lives outside this package and takes the constant from shared/languages directly.
 */

export { EXT_TBAF, EXT_TD, EXT_FALLOUT_SSL, EXT_WEIDU_BAF, EXT_WEIDU_D } from "../../shared/languages";
