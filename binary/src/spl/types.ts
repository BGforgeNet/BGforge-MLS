/**
 * SPL v1 wire constants. Matches the IESDP `spl_v1/header.yml` 0x72 header
 * shape. Effects share their on-wire layout with ITM (decoded via shared
 * `ie-common/specs/effect.ts`); abilities are SPL-specific (40 bytes,
 * different fields than ITM's 56-byte ability).
 *
 * `EFFECT_SIZE` and `bytesEqual` live in `../ie-common/types` — shared with ITM.
 */

/** Bytes consumed by the SPL v1 header. */
export const SPL_HEADER_SIZE = 0x72;
/** Bytes consumed by one SPL extended-header (ability) record. Differs from ITM (0x38). */
export const SPL_ABILITY_SIZE = 0x28;

/** Wire bytes for SPL signature ('SPL '). */
export const SPL_SIGNATURE = [0x53, 0x50, 0x4c, 0x20] as const;
/** Wire bytes for SPL v1 version ('V1  '). */
export const SPL_VERSION_V1 = [0x56, 0x31, 0x20, 0x20] as const;
