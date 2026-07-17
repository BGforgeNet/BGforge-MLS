// Auto-generated from IESDP _data/file_formats/itm_v1/extended_header.yml. Do not hand-edit.

import { u16, u32, u8 } from "typed-binary";
import { arraySpec, charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const itmAbilitySpec = {
    attackType: { codec: u8, description: "Attack type - 0 -> None - 1 -> Melee - 2 -> Ranged - 3 -> Magical - 4 -> Launcher For Item abilities: - Do NOT use `0|None`, will crash the game.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    idRequired: { codec: u8, description: "ID Req. - bit 0 -> ID Required - bit 1 -> Non-ID Required" },
    location: { codec: u8, description: "Location - 0 -> None - Ability will not be selectable through the UI (but still available to scripts and spell-casting opcodes).", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    alternativeDiceSides: { codec: u8, description: "Alternative dice sides" },
    useIcon: charsSpec(8),
    target: { codec: u8, description: "Target type - 0 -> Invalid (cannot be selected) - 1 -> Living actor - Targets Portrait, Creature/Actor , Container , or Door .", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    targetCount: { codec: u8, description: "Target count - Only usable by Item abilities, and only with Ability Targets 1 , 3 , or 4 .", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    range: { codec: u16, description: "Range" },
    projectileType: { codec: u8, description: "Launcher required - 0 -> None - 1 -> Bow - Any Ranged ability with this field set to this value will require a weapon with the corresponding ITEMCAT.IDS (Item category) in one of the mainhand weapon ...", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    alternativeDiceThrown: { codec: u8, description: "Alternative dice thrown" },
    speed: { codec: u8, description: "Speed Factor - See opcode #190." },
    alternativeDamageBonus: { codec: u8, description: "Alternative damage bonus" },
    thac0Bonus: { codec: u16, description: "THAC0 bonus A successful hit will always occur if any of the conditions below is true - This field is set to `32767`.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    diceSides: { codec: u8, description: "Dice sides" },
    primaryType: { codec: u8, description: "Primary Type (School) - See MSCHOOL.2DA ." },
    diceThrown: { codec: u8, description: "Dice thrown" },
    secondaryType: { codec: u8, description: "Secondary Type - See MSECTYPE.2DA ." },
    damageBonus: { codec: u16, description: "Damage bonus" },
    damageType: { codec: u16, description: "Damage type - 0 -> None - Deals Crushing damage, uses base AC (ignores all 4 specific AC).", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    featureBlockCount: { codec: u16, description: "Count of feature blocks" },
    featureBlockIndex: { codec: u16, description: "Index into feature blocks" },
    maxCharges: { codec: u16, description: "Max Charges" },
    depletion: { codec: u16, description: "Charge depletion behaviour - 0 -> Item remains - Item becomes unusable (except as a weapon) when Max Charges reaches zero.", docUrl: "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm" },
    flags: { codec: u32, description: "Flags" },
    projectileAnimation: { codec: u16, description: "Projectile Animation (projectl.ids/missile.ids)" },
    meleeAnimation: arraySpec({ element: { codec: u16 }, count: 3 }),
    isArrow: { codec: u16, description: "Arrow qualifier / Is arrow? - 0 -> No - 1 -> Yes It controls which firing animation the ability will use. It needs to be set on any launcher and/or ammo, but the launcher will override the ammo." },
    isBolt: { codec: u16, description: "Bolt qualifier / Is bolt? - 0 -> No - 1 -> Yes It controls which firing animation the ability will use. It needs to be set on any launcher and/or ammo, but the launcher will override the ammo." },
    isBullet: { codec: u16, description: "Bullet qualifier / Is bullet? - 0 -> No - 1 -> Yes It controls which firing animation the ability will use. It needs to be set on any launcher and/or ammo, but the launcher will override the ammo." },
} satisfies Record<string, FieldSpec>;

export type ItmAbilityData = SpecData<typeof itmAbilitySpec>;
