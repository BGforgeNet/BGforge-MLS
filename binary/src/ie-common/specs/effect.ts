// Auto-generated from IESDP _data/file_formats/itm_v1/feature_block.yml. Do not hand-edit.

import { u16, u32, u8 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const effectSpec = {
    opcode: { codec: u16, description: "Opcode Number" },
    target: { codec: u8, description: "Target type - 0 -> None - 1 -> Self - 2 -> Projectile target - 3 -> Party - 4 -> Everyone - 5 -> Everyone except party - 6 -> Caster group - 7 -> Target group - 8 -> Everyone except self - 9 -> ...", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    power: { codec: u8, description: "Power" },
    parameter1: { codec: u32, description: "Parameter 1" },
    parameter2: { codec: u32, description: "Parameter 2" },
    timing: { codec: u8, description: "Timing mode - 0 -> Instant/Limited - 1 -> Instant/Permanent - 2 -> Instant/While equipped - 3 -> Delay/Limited - 4 -> Delay/Permanent - 5 -> Delay/While equipped - 6 -> Limited after duration - 7 -> ...", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    resistance: { codec: u8, description: "Dispel / Resistance The default behaviour is that effects cannot be dispelled and ignore magic resistance.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    duration: { codec: u32, description: "Duration" },
    probability1: { codec: u8, description: "Probability 1" },
    probability2: { codec: u8, description: "Probability 2 See here for further details." },
    resource: charsSpec(8),
    maxLevel: { codec: u32, description: "Dice Thrown / Maximum Level See here for further details." },
    minLevel: { codec: u32, description: "Dice Sides / Minimum Level See here for further details." },
    saveType: { codec: u32, description: "Saving throw type - bit 0 -> Spells - bit 1 -> Breath - bit 2 -> Paralyze / Poison / Death - bit 3 -> Wands - bit 4 -> Petrify / Polymorph - bit 10 -> Ignore primary target (EE only) - bit 11 -> ...", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    saveBonus: { codec: u32, description: "Saving Throw Bonus" },
    stackingIdEx: { codec: u32, description: "TobEx: Stacking ID.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
} satisfies Record<string, FieldSpec>;

export type EffectData = SpecData<typeof effectSpec>;
