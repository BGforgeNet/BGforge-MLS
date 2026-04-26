import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

/**
 * Wire spec for stairs scenery (8 bytes). The first u32 is bit-packed: low
 * 26 bits are the destination tile index, high 6 bits are the destination
 * elevation. The packed-field primitive surfaces both as flat top-level
 * canonical entries while reading and writing one shared u32 on the wire.
 */
export const stairsSpec = {
    destTile: {
        codec: u32,
        packedAs: "destTileAndElevation",
        bitRange: [0, 26],
        domain: { min: 0, max: 0x03_ff_ff_ff },
    },
    destElevation: { codec: u32, packedAs: "destTileAndElevation", bitRange: [26, 6], domain: { min: 0, max: 0x3f } },
    destMap: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type StairsData = SpecData<typeof stairsSpec>;

export const stairsPresentation: StructPresentation<StairsData> = {
    destTile: { label: "Dest Tile" },
    destElevation: { label: "Dest Elevation" },
    destMap: { label: "Dest Map" },
};
