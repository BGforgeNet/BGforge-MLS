import { u32, i32 } from "typed-binary";
import { Perk } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const armorSpec = {
    ac: { codec: u32 },
    drNormal: { codec: u32 },
    drLaser: { codec: u32 },
    drFire: { codec: u32 },
    drPlasma: { codec: u32 },
    drElectrical: { codec: u32 },
    drEmp: { codec: u32 },
    drExplosion: { codec: u32 },
    dtNormal: { codec: u32 },
    dtLaser: { codec: u32 },
    dtFire: { codec: u32 },
    dtPlasma: { codec: u32 },
    dtElectrical: { codec: u32 },
    dtEmp: { codec: u32 },
    dtExplosion: { codec: u32 },
    // Granted perk (fallout2-ce Perk enum); signed because -1 = none. Open: sfall can add perks beyond 119.
    perk: { codec: i32, enum: Perk, enumOpen: true },
    maleFrmId: { codec: i32 },
    femaleFrmId: { codec: i32 },
} satisfies Record<string, FieldSpec>;

export type ArmorData = SpecData<typeof armorSpec>;

export const armorPresentation: StructPresentation<ArmorData> = {
    ac: { label: "AC" },
    drNormal: { label: "Normal", unit: "%" },
    drLaser: { label: "Laser", unit: "%" },
    drFire: { label: "Fire", unit: "%" },
    drPlasma: { label: "Plasma", unit: "%" },
    drElectrical: { label: "Electrical", unit: "%" },
    drEmp: { label: "EMP", unit: "%" },
    drExplosion: { label: "Explosion", unit: "%" },
    dtNormal: { label: "Normal" },
    dtLaser: { label: "Laser" },
    dtFire: { label: "Fire" },
    dtPlasma: { label: "Plasma" },
    dtElectrical: { label: "Electrical" },
    dtEmp: { label: "EMP" },
    dtExplosion: { label: "Explosion" },
    perk: { label: "Perk" },
    // Packed type-encoded FIDs (FRM type in the high byte, e.g. 0x01000096 = type 1); hex like MAP FID/PID.
    maleFrmId: { label: "Male FRM ID", format: "hex32" },
    femaleFrmId: { label: "Female FRM ID", format: "hex32" },
};
