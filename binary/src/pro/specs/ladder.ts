import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

/**
 * Wire spec for the ladder-bottom and ladder-top scenery subtypes (4 bytes
 * each). `destTileAndElevation` packs the same 26+6 bit layout as stairs.
 */
export const ladderSpec = {
    destTileAndElevation: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type LadderData = SpecData<typeof ladderSpec>;
