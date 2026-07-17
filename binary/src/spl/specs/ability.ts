// Auto-generated from IESDP _data/file_formats/spl_v1/extended_header.yml. Do not hand-edit.

import { u16, u8 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const splAbilitySpec = {
    form: { codec: u8, description: "Spell form - 1 - Standard - 2 - Projectile This field matters only for ITM , SPL files shouldn't function any different based on their type (even `0`)." },
    friendly: { codec: u8, description: "- bit 2: 'Friendly' ability (PST only)" },
    location: { codec: u16, description: "Location - 0 -> None - Ability will not be selectable through the UI (but still available to scripts and spell-casting opcodes).", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    memorisedIcon: charsSpec(8),
    target: { codec: u8, description: "Target - 0 -> Invalid (cannot be selected) - 1 -> Living actor - Targets Portrait, Creature/Actor , Container , or Door .", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    targetCount: { codec: u8, description: "Target count - Only usable with Ability Targets 1 , 3 , or 4 .", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    range: { codec: u16, description: "Range As far as subspells are concerned, their Range is only checked if cast through opcode #148 , opcode #232 , opcode #258 , or opcode #260 ." },
    levelRequired: { codec: u16, description: "Level Required Standard spellcasting only utilizes the first byte (`0 - 255`), but opcodes that specify Casting Level ( 146 * p2=2 / 326 * EFF / 333 ) have access to the entire range (`0 - 65535`)." },
    castingTime: { codec: u16, description: "Casting Time - This value represents the number of tenths of rounds that it takes to cast the spell.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    timesPerDay: { codec: u16, description: "Times per day" },
    unused1: { codec: u16 },
    unused2: { codec: u16 },
    unused3: { codec: u16 },
    unused4: { codec: u16 },
    featureBlocksCount: { codec: u16, description: "Count of feature blocks" },
    featureBlocksOffset: { codec: u16, description: "Offset to feature blocks" },
    unused5: { codec: u16 },
    unused6: { codec: u16 },
    projectile: { codec: u16, description: "Projectile (BG2: projectl.ids. **Note:** in BG2, this value is off-by-one from projectl.ids value. I.e. binary value of `2` corresponds to `0x1 - ARROW`)" },
} satisfies Record<string, FieldSpec>;

export type SplAbilityData = SpecData<typeof splAbilitySpec>;
