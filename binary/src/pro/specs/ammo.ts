import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const ammoSpec = {
    caliber: { codec: u32 },
    quantity: { codec: u32 },
    acModifier: { codec: u32 },
    drModifier: { codec: u32 },
    damageMultiplier: { codec: u32 },
    damageDivisor: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type AmmoData = SpecData<typeof ammoSpec>;
