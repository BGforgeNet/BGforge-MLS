// Auto-generated from IESDP _data/file_formats/itm_v1/header.yml. Do not hand-edit.

import { i32, u16, u32, u8 } from "typed-binary";
import { arraySpec, charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const itmHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    unidentifiedName: { codec: i32, ref: { kind: "strref" }, description: "Unidentified Name (strref)" },
    identifiedName: { codec: i32, ref: { kind: "strref" }, description: "Identified Name (strref)" },
    replacement: charsSpec(8),
    flags: { codec: u32, description: "Flags" },
    type: { codec: u16, description: "Item type" },
    usabilityFlags: arraySpec({ element: { codec: u8 }, count: 4 }),
    animation: charsSpec(2),
    minLevel: { codec: u16, description: "Min Level - Treated as average of all active class levels, rounded up.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    minStrength: { codec: u16, description: "Min Strength (unused in BG1)" },
    minStrengthBonus: { codec: u8, description: "Min Strength Bonus (unused in BG1) Note: A strength of 19 or above is considered to have a Strength Bonus of 0, and would therefore not be able to equip any weapon with a Strength Bonus restriction." },
    kitUsability1: { codec: u8, description: "Kit Usability 1" },
    minIntelligence: { codec: u8, description: "Min Intelligence (unused in BG1)" },
    kitUsability2: { codec: u8, description: "Kit Usability 2" },
    minDexterity: { codec: u8, description: "Min Dexterity (unused in BG1)" },
    kitUsability3: { codec: u8, description: "Kit Usability 3" },
    minWisdom: { codec: u8, description: "Min Wisdom (unused in BG1)" },
    kitUsability4: { codec: u8, description: "Kit Usability 4" },
    minConstitution: { codec: u8, description: "Min Constitution (unused in BG1)" },
    weaponProficiency: { codec: u8, description: "Weapon Proficiency" },
    minCharisma: { codec: u16, description: "Min Charisma" },
    price: { codec: u32, description: "Price" },
    stackAmount: { codec: u16, description: "Stack amount" },
    inventoryIcon: charsSpec(8),
    loreToId: { codec: u16, description: "Lore to ID" },
    groundIcon: charsSpec(8),
    weight: { codec: u32, description: "Weight" },
    unidentifiedDesc: { codec: i32, ref: { kind: "strref" }, description: "Unidentified Description (strref)" },
    identifiedDesc: { codec: i32, ref: { kind: "strref" }, description: "Identified Description (strref)" },
    descriptionIcon: charsSpec(8),
    enchantment: { codec: u32, description: "Enchantment" },
    extendedHeadersOffset: { codec: u32, description: "Offset to extended headers" },
    extendedHeadersCount: { codec: u16, description: "Count of extended headers" },
    featureBlocksOffset: { codec: u32, description: "Offset to feature blocks" },
    featureBlocksIndex: { codec: u16, description: "Index into equipping feature blocks" },
    featureBlocksCount: { codec: u16, description: "Count of equipping feature blocks" },
} satisfies Record<string, FieldSpec>;

export type ItmHeaderData = SpecData<typeof itmHeaderSpec>;
