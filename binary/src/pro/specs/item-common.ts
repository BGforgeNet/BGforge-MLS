import { u8, u32, i8, i32 } from "typed-binary";
import { AttackSubType, ItemFlagsExt, ItemSubType, MaterialType, ScriptType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { i24, u24 } from "../../spec/codec-meta";

/**
 * Wire-shape spec for the PRO item-common section (33 bytes, offset 0x18).
 *
 * `scriptType` (1 byte) + `scriptId` (3 bytes) read consecutively from the
 * 4-byte packed wire field. Both use signed codecs so that the wire's
 * `0xffffffff` "no script" pattern reads naturally as `{type: -1, id: -1}`,
 * with no separate sentinel layer.
 */
export const itemCommonSpec = {
    flagsExt: { codec: u24, flags: ItemFlagsExt },
    // The "Attack modes" byte packs two independent attack-mode subtypes: primary in the low nibble, secondary
    // in the high nibble (fallout2-ce reads `extendedFlags & 0xF` / `>> 4`). Split into two packed parts sharing
    // the one wire byte so each renders as its own dropdown, the same shape as the CRE proficiency byte split.
    attackModePrimary: { codec: u8, packedAs: "attackModes", bitRange: [0, 4], enum: AttackSubType, enumOpen: true },
    attackModeSecondary: { codec: u8, packedAs: "attackModes", bitRange: [4, 4], enum: AttackSubType, enumOpen: true },
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
    attackModePrimary: { label: "Attack Mode (Primary)" },
    attackModeSecondary: { label: "Attack Mode (Secondary)" },
    scriptType: { label: "Script Type" },
    scriptId: { label: "Script ID" },
    subType: { label: "Sub Type" },
    materialId: { label: "Material" },
    size: { label: "Size" },
    weight: { label: "Weight", unit: "pounds" },
    cost: { label: "Cost", unit: "caps" },
    // Packed type-encoded FID (FRM type in the high byte, e.g. 0x07000189 = type 7); hex makes the type
    // nibble legible, like MAP FID/PID. All sampled inventory FIDs are 0x07......; -1 (0xffffffff) = none.
    inventoryFrmId: { label: "Inventory FRM ID", format: "hex32" },
    soundId: { label: "Sound ID" },
};
