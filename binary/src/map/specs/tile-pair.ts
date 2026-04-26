import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

/**
 * Wire spec for one tile-pair (4 bytes / one u32, big-endian). Each map
 * elevation has 10 000 of these laid end-to-end.
 *
 * Bit layout (LSB=0):
 *   bits  0-11 — floor tile id   (12 bits)
 *   bits 12-15 — floor flags     (4 bits)
 *   bits 16-27 — roof tile id    (12 bits)
 *   bits 28-31 — roof flags      (4 bits)
 */
export const tilePairSpec = {
    floorTileId: { codec: u32, packedAs: "tilePair", bitRange: [0, 12], domain: { min: 0, max: 0xf_ff } },
    floorFlags: { codec: u32, packedAs: "tilePair", bitRange: [12, 4], domain: { min: 0, max: 0xf } },
    roofTileId: { codec: u32, packedAs: "tilePair", bitRange: [16, 12], domain: { min: 0, max: 0xf_ff } },
    roofFlags: { codec: u32, packedAs: "tilePair", bitRange: [28, 4], domain: { min: 0, max: 0xf } },
} satisfies Record<string, FieldSpec>;

export type TilePairData = SpecData<typeof tilePairSpec>;
