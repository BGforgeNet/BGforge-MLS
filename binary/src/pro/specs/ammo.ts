import { i32, u32 } from "typed-binary";
import { Caliber } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const ammoSpec = {
    // Same caliber table as the weapon that fires it (the ammo must match the weapon's caliber).
    caliber: { codec: u32, enum: Caliber },
    quantity: { codec: u32 },
    // Signed: armour-piercing ammo lowers the target's AC and DR, and the engine reads both as a signed
    // 32-bit value. Only 5 ammo protos exist across the corpus and none is negative, so the fix is sourced
    // from the engine's own struct rather than from the data.
    acModifier: { codec: i32 },
    drModifier: { codec: i32 },
    damageMultiplier: { codec: u32 },
    damageDivisor: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type AmmoData = SpecData<typeof ammoSpec>;

export const ammoPresentation: StructPresentation<AmmoData> = {
    caliber: { label: "Caliber" },
    quantity: { label: "Quantity" },
    acModifier: { label: "AC Modifier" },
    drModifier: { label: "DR Modifier" },
    damageMultiplier: { label: "Damage Multiplier" },
    damageDivisor: { label: "Damage Divisor" },
};
