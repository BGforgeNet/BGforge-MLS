import { u32 } from "typed-binary";
import { Caliber } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const ammoSpec = {
    // Same caliber table as the weapon that fires it (the ammo must match the weapon's caliber).
    caliber: { codec: u32, enum: Caliber },
    quantity: { codec: u32 },
    acModifier: { codec: u32 },
    drModifier: { codec: u32 },
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
