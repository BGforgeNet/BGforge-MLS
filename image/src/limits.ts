// Bounds for attacker-sized fields in untrusted files (.frm/.bam/.png arrive from arbitrary mod
// archives). Generous against every real asset, tight enough to fail fast on a crafted header
// instead of over-allocating or inflating a zlib bomb.
export const MAX_FRAME_PIXELS = 1 << 24; // 16.7M pixels (e.g. 4096x4096) per frame
export const MAX_INFLATED_BYTES = 1 << 28; // 256 MiB cap on any single decompressed stream

/**
 * Total pixels across every frame of one animation - 67M, a 256 MiB ceiling once decoded to RGBA.
 *
 * Needed because a BAM v2 frame is ZERO-FILLED from its header and only then blitted into, so unlike
 * FRM and BAM v1 its size needs no backing bytes in the file: without an aggregate bound a 320-byte
 * header declaring 24 frames at MAX_FRAME_PIXELS each allocates 1.5 GiB, and frame count is limited
 * only by file size / 12. Sized against the corpus rather than guessed - the largest shipped v2
 * (MAPICONS.BAM, 5888 frames) totals 26.8M pixels, so this leaves 2.4x headroom. MAX_FRAME_PIXELS
 * would NOT do as the aggregate bound: that same real file is already over it.
 */
export const MAX_ANIMATION_PIXELS = 1 << 26;
