import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

/**
 * Wire spec for the ladder-bottom and ladder-top scenery subtypes (4 bytes
 * each). Same 26+6 bit packing as stairs; uses the packed-field primitive to
 * surface flat canonical destTile + destElevation entries.
 */
export const ladderSpec = {
    destTile: {
        codec: u32,
        packedAs: "destTileAndElevation",
        bitRange: [0, 26],
        domain: { min: 0, max: 0x03_ff_ff_ff },
    },
    destElevation: { codec: u32, packedAs: "destTileAndElevation", bitRange: [26, 6], domain: { min: 0, max: 0x3f } },
} satisfies Record<string, FieldSpec>;

export type LadderData = SpecData<typeof ladderSpec>;

export const ladderPresentation: StructPresentation<LadderData> = {
    destTile: { label: "Dest Tile" },
    destElevation: { label: "Dest Elevation" },
};
