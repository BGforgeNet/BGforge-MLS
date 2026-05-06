// Auto-generated from IESDP _data/file_formats/itm_v1/header.yml. Do not hand-edit.

import { i32, u16, u32, u8 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";

export const itmHeaderSpec = {
    signature: arraySpec({ element: { codec: u8 }, count: 4 }),
    version: arraySpec({ element: { codec: u8 }, count: 4 }),
    unidentifiedName: { codec: i32 },
    identifiedName: { codec: i32 },
    replacement: arraySpec({ element: { codec: u8 }, count: 8 }),
    flags: { codec: u32 },
    type: { codec: u16 },
    usabilityFlags: arraySpec({ element: { codec: u8 }, count: 4 }),
    animation: arraySpec({ element: { codec: u8 }, count: 2 }),
    minLevel: { codec: u16 },
    minStrength: { codec: u16 },
    minStrengthBonus: { codec: u8 },
    kitUsability1: { codec: u8 },
    minIntelligence: { codec: u8 },
    kitUsability2: { codec: u8 },
    minDexterity: { codec: u8 },
    kitUsability3: { codec: u8 },
    minWisdom: { codec: u8 },
    kitUsability4: { codec: u8 },
    minConstitution: { codec: u8 },
    weaponProficiency: { codec: u8 },
    minCharisma: { codec: u16 },
    price: { codec: u32 },
    stackAmount: { codec: u16 },
    inventoryIcon: arraySpec({ element: { codec: u8 }, count: 8 }),
    loreToId: { codec: u16 },
    groundIcon: arraySpec({ element: { codec: u8 }, count: 8 }),
    weight: { codec: u32 },
    unidentifiedDesc: { codec: i32 },
    identifiedDesc: { codec: i32 },
    descriptionIcon: arraySpec({ element: { codec: u8 }, count: 8 }),
    enchantment: { codec: u32 },
    extendedHeadersOffset: { codec: u32 },
    extendedHeadersCount: { codec: u16 },
    featureBlocksOffset: { codec: u32 },
    featureBlocksIndex: { codec: u16 },
    featureBlocksCount: { codec: u16 },
} satisfies Record<string, FieldSpec>;

export type ItmHeaderData = SpecData<typeof itmHeaderSpec>;
