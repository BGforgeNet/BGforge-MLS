// Bounds for attacker-sized fields in untrusted files (.frm/.bam/.png arrive from arbitrary mod
// archives). Generous against every real asset, tight enough to fail fast on a crafted header
// instead of over-allocating or inflating a zlib bomb.
export const MAX_FRAME_PIXELS = 1 << 24; // 16.7M pixels (e.g. 4096x4096) per frame
export const MAX_INFLATED_BYTES = 1 << 28; // 256 MiB cap on any single decompressed stream
