// Auto-generated from IESDP _data/file_formats/spl_v1/extended_header.yml. Do not hand-edit.

import { u16, u8 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";

export const splAbilitySpec = {
    form: { codec: u8 },
    friendly: { codec: u8 },
    location: { codec: u16 },
    memorisedIcon: arraySpec({ element: { codec: u8 }, count: 8 }),
    target: { codec: u8 },
    targetCount: { codec: u8 },
    range: { codec: u16 },
    levelRequired: { codec: u16 },
    castingTime: { codec: u16 },
    timesPerDay: { codec: u16 },
    unused1: { codec: u16 },
    unused2: { codec: u16 },
    unused3: { codec: u16 },
    unused4: { codec: u16 },
    featureBlocksCount: { codec: u16 },
    featureBlocksOffset: { codec: u16 },
    unused5: { codec: u16 },
    unused6: { codec: u16 },
    projectile: { codec: u16 },
} satisfies Record<string, FieldSpec>;

export type SplAbilityData = SpecData<typeof splAbilitySpec>;
