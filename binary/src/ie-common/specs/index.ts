/**
 * Barrel re-exports for shared Infinity Engine specs.
 *
 * ITM and SPL `feature_block` (effect) is byte-identical between formats —
 * shared here. `extended_header` (ability) is NOT shared: ITM ability is
 * 56 bytes, SPL ability is 40 bytes with different fields. Each format
 * therefore generates its own `<format>/specs/ability.ts`.
 */

export { effectSpec, type EffectData } from "./effect";
