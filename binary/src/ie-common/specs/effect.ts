// Auto-generated from IESDP _data/file_formats/itm_v1/feature_block.yml. Do not hand-edit.

import { u16, u32, u8 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";

export const effectSpec = {
    opcode: { codec: u16 },
    target: { codec: u8 },
    power: { codec: u8 },
    parameter1: { codec: u32 },
    parameter2: { codec: u32 },
    timing: { codec: u8 },
    resistance: { codec: u8 },
    duration: { codec: u32 },
    probability1: { codec: u8 },
    probability2: { codec: u8 },
    resource: arraySpec({ element: { codec: u8 }, count: 8 }),
    maxLevel: { codec: u32 },
    minLevel: { codec: u32 },
    saveType: { codec: u32 },
    saveBonus: { codec: u32 },
    stackingIdEx: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type EffectData = SpecData<typeof effectSpec>;
