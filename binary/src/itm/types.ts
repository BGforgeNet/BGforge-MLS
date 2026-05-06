/**
 * ITM v1 wire constants.
 *
 * Fixed-size 0x72 (114 bytes) header. Signature/version are stored as
 * `char[4]` arrays on the wire (per IESDP `itm_v1/header.yml`); we keep the
 * wire bytes verbatim and validate against the canonical strings on parse.
 *
 * `EFFECT_SIZE` and `bytesEqual` live in `../ie-common/types` — shared with SPL.
 */

/** Bytes consumed by the ITM v1 header. */
export const ITM_HEADER_SIZE = 0x72;
/** Bytes consumed by one ITM extended-header (ability) record. */
export const ITM_ABILITY_SIZE = 0x38;

/** Wire bytes (4 ASCII chars) for ITM signature. */
export const ITM_SIGNATURE = [0x49, 0x54, 0x4d, 0x20] as const; // "ITM "
/** Wire bytes (4 ASCII chars) for ITM v1 version. */
export const ITM_VERSION_V1 = [0x56, 0x31, 0x20, 0x20] as const; // "V1  "
