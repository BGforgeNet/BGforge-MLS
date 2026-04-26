import { u8, u32, i32 } from "typed-binary";
import { ItemFlagsExt, ItemSubType, MaterialType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import { u24 } from "../../spec/codec-meta";

/**
 * Wire-shape spec for the PRO item-common section (33 bytes, offset 0x18).
 *
 * `scriptId` is packed: high byte is the script type (with -1 meaning "no
 * script", encoded as 0xFFFFFFFF), low three bytes are the script id. The
 * canonical document splits these into a `script: { type, id }` ref. The
 * unpacking lives in canonical-reader/writer until a packed-field primitive
 * lands.
 */
export const itemCommonSpec = {
    flagsExt: { codec: u24, flags: ItemFlagsExt },
    attackModes: { codec: u8 },
    scriptId: { codec: u32 },
    subType: { codec: u32, enum: ItemSubType },
    materialId: { codec: u32, enum: MaterialType },
    size: { codec: u32 },
    weight: { codec: u32 },
    cost: { codec: u32 },
    inventoryFrmId: { codec: i32 },
    soundId: { codec: u8 },
} satisfies Record<string, FieldSpec>;

export type ItemCommonData = SpecData<typeof itemCommonSpec>;
