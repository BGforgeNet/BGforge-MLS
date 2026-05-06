/**
 * EFF v2 wire constants and EFF-specific lookup tables.
 *
 * The body's opcode/target/timing/resistance/saveType fields share semantics
 * with the ITM/SPL feature_block (effect) record but use a wider 0x108-byte
 * record. Lookups for the shared fields come from `../ie-common/types` +
 * `../ie-common/opcodes`; EFF-specific extras live here.
 */

/** Bytes consumed by the EFF v2 header (signature + version). */
export const EFF_HEADER_SIZE = 0x08;
/** Bytes consumed by the EFF v2 body. */
export const EFF_BODY_SIZE = 0x108;
/** Total file size for an EFF v2 record. */
export const EFF_TOTAL_SIZE = EFF_HEADER_SIZE + EFF_BODY_SIZE;

/** Wire bytes for EFF signature ('EFF '). */
export const EFF_SIGNATURE = [0x45, 0x46, 0x46, 0x20] as const;
/** Wire bytes for EFF v2 version ('V2.0'). */
export const EFF_VERSION_V2 = [0x56, 0x32, 0x2e, 0x30] as const;
