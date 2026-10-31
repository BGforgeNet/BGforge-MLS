/**
 * In-repo entry point: the INT route the BGforge MLS server compiles through - the same front end, lowered to
 * the SSL compiler's program rather than rendered as SSL text.
 *
 * Nothing here carries a semver promise. Anything an outside consumer of @bgforge/tssl should be able to call
 * belongs in index.ts instead.
 */

export { lowerTsslProgram } from "./int/lower";
