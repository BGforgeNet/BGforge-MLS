import { u8, u32, i32 } from "typed-binary";
import { DamageType, WeaponAnimCode } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";

export const weaponSpec = {
    animCode: { codec: u32, enum: WeaponAnimCode },
    minDamage: { codec: u32 },
    maxDamage: { codec: u32 },
    damageType: { codec: u32, enum: DamageType },
    maxRange1: { codec: u32 },
    maxRange2: { codec: u32 },
    projectilePid: { codec: i32 },
    minStrength: { codec: u32 },
    apCost1: { codec: u32 },
    apCost2: { codec: u32 },
    criticalFail: { codec: u32 },
    perk: { codec: u32 },
    rounds: { codec: u32 },
    caliber: { codec: u32 },
    ammoPid: { codec: i32 },
    maxAmmo: { codec: u32 },
    soundId: { codec: u8 },
} satisfies Record<string, FieldSpec>;

export type WeaponData = SpecData<typeof weaponSpec>;
