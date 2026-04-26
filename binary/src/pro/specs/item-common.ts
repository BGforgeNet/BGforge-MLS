import { u8, u32, i8, i32 } from "typed-binary";
import { ItemFlagsExt, ItemSubType, MaterialType, ScriptType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { i24, u24 } from "../../spec/codec-meta";

/**
 * Wire-shape spec for the PRO item-common section (33 bytes, offset 0x18).
 *
 * `scriptType` (1 byte) + `scriptId` (3 bytes) read consecutively from the
 * 4-byte packed wire field. Both use signed codecs so that the wire's
 * `0xff_ff_ff_ff` "no script" pattern reads naturally as `{type: -1, id: -1}`,
 * with no separate sentinel layer.
 */
export const itemCommonSpec = {
    flagsExt: { codec: u24, flags: ItemFlagsExt },
    attackModes: { codec: u8 },
    scriptType: { codec: i8, enum: ScriptType },
    scriptId: { codec: i24 },
    subType: { codec: u32, enum: ItemSubType },
    materialId: { codec: u32, enum: MaterialType },
    size: { codec: u32 },
    weight: { codec: u32 },
    cost: { codec: u32 },
    inventoryFrmId: { codec: i32 },
    soundId: { codec: u8 },
} satisfies Record<string, FieldSpec>;

export type ItemCommonData = SpecData<typeof itemCommonSpec>;

export const itemCommonPresentation: StructPresentation<ItemCommonData> = {
    flagsExt: { label: "Flags Ext" },
    attackModes: { label: "Attack Modes" },
    scriptType: { label: "Script Type" },
    scriptId: { label: "Script ID" },
    subType: { label: "Sub Type" },
    materialId: { label: "Material" },
    size: { label: "Size" },
    weight: { label: "Weight", unit: "pounds" },
    cost: { label: "Cost", unit: "caps" },
    inventoryFrmId: { label: "Inventory FRM ID" },
    soundId: { label: "Sound ID" },
};
