// Auto-generated from IESDP _data/file_formats/spl_v1/header.yml. Do not hand-edit.

import { i32, u16, u32, u8 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const splHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    unidentifiedName: { codec: i32, strref: true, description: "Spell Name - Unidentified (strref)" },
    unused1: { codec: i32, strref: true },
    completionSound: charsSpec(8),
    flags: { codec: u32, description: "Flags" },
    type: { codec: u16, description: "Spell type : - 0 -> Special - 1 -> Wizard - 2 -> Priest - 3 -> Psionic - 4 -> Innate - 5 -> Bard song - Special , Psionic , Innate , and Bard song differ only by the string displayed when you cast ...", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    exclusionFlags: { codec: u32, description: "Exclusion Flags" },
    castingGraphics: { codec: u16, description: "Casting Graphics" },
    unused2: { codec: u8 },
    school: { codec: u8, description: "Primary Type (School) (IWD: school.2da, BG2:mschool.2da) For subspells, Primary Type should always match parent spell, both for interaction with opcodes #220 / #229 , and with the specialists save ...", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    unused3: { codec: u8 },
    sectype: { codec: u8, description: "Secondary Type (BG2:msectype.2da) For subspells, Secondary Type should always match parent spell, for interaction with opcodes #221 / #230 ." },
    unused4: { codec: u8 },
    unused5: { codec: u8 },
    unused6: { codec: u8 },
    unused7: { codec: u8 },
    unused8: { codec: u8 },
    unused9: { codec: u8 },
    unused10: { codec: u8 },
    unused11: { codec: u8 },
    unused12: { codec: u16 },
    unused13: { codec: u16 },
    level: { codec: u32, description: "Spell Level - There is no good reason for a Special / Psionic / Innate / Bard song to be any Spell level except `1`.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/spl_v1.htm" },
    unused14: { codec: u16 },
    spellbookIcon: charsSpec(8),
    unused15: { codec: u16 },
    unused16: charsSpec(8),
    unused17: { codec: u32 },
    description: { codec: i32, strref: true, description: "Spell Description" },
    unused18: { codec: i32, strref: true },
    unused19: charsSpec(8),
    unused20: { codec: u32 },
    extendedHeadersOffset: { codec: u32, description: "Extended Header offset" },
    extendedHeadersCount: { codec: u16, description: "Extended Header count" },
    featureBlocksOffset: { codec: u32, description: "Feature Block Table offset" },
    castingFeatureBlocksIndex: { codec: u16, description: "Casting Feature Block index (these feature blocks may not use target type 2)" },
    castingFeatureBlocksCount: { codec: u16, description: "Casting Feature Block count" },
} satisfies Record<string, FieldSpec>;

export type SplHeaderData = SpecData<typeof splHeaderSpec>;
