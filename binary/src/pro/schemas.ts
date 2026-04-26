/**
 * typed-binary schema definitions for PRO file format.
 * Replaces pro-parsers.ts (binary-parser). Each schema is bidirectional:
 * the same definition drives both read() and write().
 *
 * Endianness is set on the BufferReader/BufferWriter, not in the schema.
 * PRO files are big-endian: use { endianness: 'big' }.
 */

import { object, u8, u16, u32, i32, type Parsed } from "typed-binary";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { ammoSpec } from "./specs/ammo";
import { armorSpec } from "./specs/armor";
import { containerSpec } from "./specs/container";
import { drugSpec } from "./specs/drug";
import { headerSpec } from "./specs/header";
import { itemCommonSpec } from "./specs/item-common";
import { keySpec } from "./specs/key";
import { miscItemSpec } from "./specs/misc-item";
import { weaponSpec } from "./specs/weapon";

// -- Header (24 bytes, 0x00-0x17) -------------------------------------------

export const headerSchema = toTypedBinarySchema(headerSpec);

// -- Item common (33 bytes, 0x18-0x38) --------------------------------------

export const itemCommonSchema = toTypedBinarySchema(itemCommonSpec);

// -- Item subtypes ----------------------------------------------------------

export const armorSchema = toTypedBinarySchema(armorSpec);

export const containerSchema = toTypedBinarySchema(containerSpec);

export const drugSchema = toTypedBinarySchema(drugSpec);

export const weaponSchema = toTypedBinarySchema(weaponSpec);

export const ammoSchema = toTypedBinarySchema(ammoSpec);

export const miscItemSchema = toTypedBinarySchema(miscItemSpec);

export const keySchema = toTypedBinarySchema(keySpec);

// -- Critter (392 bytes at 0x18-0x19F, total file 416) ----------------------

export const critterSchema = object({
    flagsExt: u32,
    scriptId: u32,
    headFrmId: i32,
    aiPacket: u32,
    teamNumber: u32,
    critterFlags: u32,
    // Base primary stats
    strength: u32,
    perception: u32,
    endurance: u32,
    charisma: u32,
    intelligence: u32,
    agility: u32,
    luck: u32,
    // Base secondary stats
    hitPoints: u32,
    actionPoints: u32,
    armorClass: u32,
    unarmedDamage: u32,
    meleeDamage: u32,
    carryWeight: u32,
    sequence: u32,
    healingRate: u32,
    criticalChance: u32,
    betterCriticals: u32,
    // Base damage thresholds
    dtNormal: u32,
    dtLaser: u32,
    dtFire: u32,
    dtPlasma: u32,
    dtElectrical: u32,
    dtEmp: u32,
    dtExplosive: u32,
    // Base damage resistances
    drNormal: u32,
    drLaser: u32,
    drFire: u32,
    drPlasma: u32,
    drElectrical: u32,
    drEmp: u32,
    drExplosive: u32,
    drRadiation: u32,
    drPoison: u32,
    // Demographics
    age: u32,
    gender: u32,
    // Bonus primary stats
    strengthBonus: i32,
    perceptionBonus: i32,
    enduranceBonus: i32,
    charismaBonus: i32,
    intelligenceBonus: i32,
    agilityBonus: i32,
    luckBonus: i32,
    // Bonus secondary stats
    hitPointsBonus: i32,
    actionPointsBonus: i32,
    armorClassBonus: i32,
    unarmedDamageBonus: i32,
    meleeDamageBonus: i32,
    carryWeightBonus: i32,
    sequenceBonus: i32,
    healingRateBonus: i32,
    criticalChanceBonus: i32,
    betterCriticalsBonus: i32,
    // Bonus damage thresholds
    dtNormalBonus: i32,
    dtLaserBonus: i32,
    dtFireBonus: i32,
    dtPlasmaBonus: i32,
    dtElectricalBonus: i32,
    dtEmpBonus: i32,
    dtExplosiveBonus: i32,
    // Bonus damage resistances
    drNormalBonus: i32,
    drLaserBonus: i32,
    drFireBonus: i32,
    drPlasmaBonus: i32,
    drElectricalBonus: i32,
    drEmpBonus: i32,
    drExplosiveBonus: i32,
    drRadiationBonus: i32,
    drPoisonBonus: i32,
    // Bonus demographics
    ageBonus: i32,
    genderBonus: i32,
    // Skills
    skillSmallGuns: i32,
    skillBigGuns: i32,
    skillEnergyWeapons: i32,
    skillUnarmed: i32,
    skillMelee: i32,
    skillThrowing: i32,
    skillFirstAid: i32,
    skillDoctor: i32,
    skillSneak: i32,
    skillLockpick: i32,
    skillSteal: i32,
    skillTraps: i32,
    skillScience: i32,
    skillRepair: i32,
    skillSpeech: i32,
    skillBarter: i32,
    skillGambling: i32,
    skillOutdoorsman: i32,
    // Final fields
    bodyType: u32,
    expValue: u32,
    killType: u32,
    damageType: u32,
});

// -- Scenery common (17 bytes, 0x18-0x28) -----------------------------------

export const sceneryCommonSchema = object({
    wallLightFlags: u16,
    actionFlags: u16,
    scriptId: u32,
    subType: u32,
    materialId: u32,
    soundId: u8,
});

// -- Scenery subtypes -------------------------------------------------------

export const doorSchema = object({
    walkThruFlag: u32,
    unknown: u32,
});

export const stairsSchema = object({
    destTileAndElevation: u32,
    destMap: u32,
});

export const elevatorSchema = object({
    elevatorType: u32,
    elevatorLevel: u32,
});

export const ladderSchema = object({
    destTileAndElevation: u32,
});

export const genericScenerySchema = object({
    unknown: u32,
});

// -- Wall (12 bytes, 0x18-0x23) ---------------------------------------------

export const wallSchema = object({
    wallLightFlags: u16,
    actionFlags: u16,
    scriptId: u32,
    materialId: u32,
});

// -- Tile (4 bytes, 0x18-0x1B) ----------------------------------------------

export const tileSchema = object({
    materialId: u32,
});

// -- Misc (4 bytes, 0x18-0x1B) ----------------------------------------------

export const miscSchema = object({
    unknown: u32,
});

// -- Exported data types (inferred from schemas) ----------------------------

export type { HeaderData } from "./specs/header";
export type { ItemCommonData } from "./specs/item-common";
export type { ArmorData } from "./specs/armor";
export type { ContainerData } from "./specs/container";
export type { DrugData } from "./specs/drug";
export type { WeaponData } from "./specs/weapon";
export type { AmmoData } from "./specs/ammo";
export type { MiscItemData } from "./specs/misc-item";
export type { KeyData } from "./specs/key";
export type CritterData = Parsed<typeof critterSchema>;
export type SceneryCommonData = Parsed<typeof sceneryCommonSchema>;
export type DoorData = Parsed<typeof doorSchema>;
export type StairsData = Parsed<typeof stairsSchema>;
export type ElevatorData = Parsed<typeof elevatorSchema>;
export type LadderData = Parsed<typeof ladderSchema>;
export type GenericSceneryData = Parsed<typeof genericScenerySchema>;
export type WallData = Parsed<typeof wallSchema>;
export type TileData = Parsed<typeof tileSchema>;
export type MiscData = Parsed<typeof miscSchema>;
