// Auto-generated from IESDP _data/file_formats/itm_v1/extended_header.yml. Do not hand-edit.

import { u16, u32, u8 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";

export const itmAbilitySpec = {
    attackType: { codec: u8 },
    idRequired: { codec: u8 },
    location: { codec: u8 },
    alternativeDiceSides: { codec: u8 },
    useIcon: arraySpec({ element: { codec: u8 }, count: 8 }),
    target: { codec: u8 },
    targetCount: { codec: u8 },
    range: { codec: u16 },
    projectileType: { codec: u8 },
    alternativeDiceThrown: { codec: u8 },
    speed: { codec: u8 },
    alternativeDamageBonus: { codec: u8 },
    thac0Bonus: { codec: u16 },
    diceSides: { codec: u8 },
    primaryType: { codec: u8 },
    diceThrown: { codec: u8 },
    secondaryType: { codec: u8 },
    damageBonus: { codec: u16 },
    damageType: { codec: u16 },
    featureBlockCount: { codec: u16 },
    featureBlockIndex: { codec: u16 },
    maxCharges: { codec: u16 },
    depletion: { codec: u16 },
    flags: { codec: u32 },
    projectileAnimation: { codec: u16 },
    meleeAnimation: arraySpec({ element: { codec: u16 }, count: 3 }),
    isArrow: { codec: u16 },
    isBolt: { codec: u16 },
    isBullet: { codec: u16 },
} satisfies Record<string, FieldSpec>;

export type ItmAbilityData = SpecData<typeof itmAbilitySpec>;
