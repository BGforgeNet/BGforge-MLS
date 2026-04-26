import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

/**
 * Wire spec for stairs scenery (8 bytes). `destTileAndElevation` packs a 26-bit
 * tile id (low bits) with a 6-bit elevation (high bits) into one u32; the
 * canonical document still surfaces the unpacked `destTile` / `destElevation`
 * pair until a packed-field primitive lets a single declaration drive both.
 */
export const stairsSpec = {
    destTileAndElevation: { codec: u32 },
    destMap: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type StairsData = SpecData<typeof stairsSpec>;
