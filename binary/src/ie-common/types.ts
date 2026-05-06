/**
 * Shared Infinity Engine wire constants and helpers.
 *
 * EFFECT_SIZE is shared because the on-wire feature_block layout is
 * byte-identical between ITM and SPL (and is generated once into
 * `ie-common/specs/effect.ts`). Ability size is per-format and lives in
 * `<format>/types.ts`.
 */

/** Bytes consumed by one feature-block (effect) record. */
export const EFFECT_SIZE = 0x30;

/** Element-wise equality for two byte sequences. */
export function bytesEqual(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
