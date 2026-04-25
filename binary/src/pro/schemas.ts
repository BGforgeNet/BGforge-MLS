/**
 * typed-binary schema definitions for PRO file format.
 * Replaces pro-parsers.ts (binary-parser). Each schema is bidirectional:
 * the same definition drives both read() and write().
 *
 * Endianness is set on the BufferReader/BufferWriter, not in the schema.
 * PRO files are big-endian: use { endianness: 'big' }.
 */

import {
    object,
    u8,
    u16,
    u32,
    i32,
    type Parsed,
    Schema,
    Measurer,
    type ISerialInput,
    type ISerialOutput,
    type IMeasurer,
    MaxValue,
} from "typed-binary";

// -- Custom 24-bit unsigned integer schema ----------------------------------
// PRO item common section packs flagsExt (3 bytes) + attackModes (1 byte).
// typed-binary has no native u24, so we define a custom one.
// Reads/writes 3 bytes in big-endian order (byte-level, endian-agnostic).

class Uint24Schema extends Schema<number> {
    readonly maxSize = 3;

    read(input: ISerialInput): number {
        const hi = input.readUint8();
        const mid = input.readUint8();
        const lo = input.readUint8();
        return (hi << 16) | (mid << 8) | lo;
    }

    write(output: ISerialOutput, value: number): void {
        output.writeUint8((value >> 16) & 0xff);
        output.writeUint8((value >> 8) & 0xff);
        output.writeUint8(value & 0xff);
    }

    measure(_: number | typeof MaxValue, measurer?: IMeasurer): IMeasurer {
        return (measurer ?? new Measurer()).add(3);
    }
}

const u24 = new Uint24Schema();

// -- Header (24 bytes, 0x00-0x17) -------------------------------------------

export const headerSchema = object({
    objectTypeAndId: u32,
    textId: u32,
    frmTypeAndId: u32,
    lightRadius: u32,
    lightIntensity: u32,
    flags: u32,
});

// -- Item common (33 bytes, 0x18-0x38) --------------------------------------

export const itemCommonSchema = object({
    flagsExt: u24,
    attackModes: u8,
    scriptId: u32,
    subType: u32,
    materialId: u32,
    size: u32,
    weight: u32,
    cost: u32,
    inventoryFrmId: i32,
    soundId: u8,
});

// -- Item subtypes ----------------------------------------------------------

export const armorSchema = object({
    ac: u32,
    drNormal: u32,
    drLaser: u32,
    drFire: u32,
    drPlasma: u32,
    drElectrical: u32,
    drEmp: u32,
    drExplosion: u32,
    dtNormal: u32,
    dtLaser: u32,
    dtFire: u32,
    dtPlasma: u32,
    dtElectrical: u32,
    dtEmp: u32,
    dtExplosion: u32,
    perk: u32,
    maleFrmId: i32,
    femaleFrmId: i32,
});

export const containerSchema = object({
    maxSize: u32,
    openFlags: u32,
});

export const drugSchema = object({
    stat0: i32,
    stat1: i32,
    stat2: i32,
    amount0Instant: u32,
    amount1Instant: u32,
    amount2Instant: u32,
    duration1: u32,
    amount0Delayed1: u32,
    amount1Delayed1: u32,
    amount2Delayed1: u32,
    duration2: u32,
    amount0Delayed2: u32,
    amount1Delayed2: u32,
    amount2Delayed2: u32,
    addictionRate: u32,
    addictionEffect: u32,
    addictionOnset: u32,
});

export const weaponSchema = object({
    animCode: u32,
    minDamage: u32,
    maxDamage: u32,
    damageType: u32,
    maxRange1: u32,
    maxRange2: u32,
    projectilePid: i32,
    minStrength: u32,
    apCost1: u32,
    apCost2: u32,
    criticalFail: u32,
    perk: u32,
    rounds: u32,
    caliber: u32,
    ammoPid: i32,
    maxAmmo: u32,
    soundId: u8,
});

export const ammoSchema = object({
    caliber: u32,
    quantity: u32,
    acModifier: u32,
    drModifier: u32,
    damageMultiplier: u32,
    damageDivisor: u32,
});

export const miscItemSchema = object({
    powerPid: i32,
    powerType: u32,
    charges: u32,
});

export const keySchema = object({
    keyCode: u32,
});

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

export type HeaderData = Parsed<typeof headerSchema>;
export type ItemCommonData = Parsed<typeof itemCommonSchema>;
export type ArmorData = Parsed<typeof armorSchema>;
export type ContainerData = Parsed<typeof containerSchema>;
export type DrugData = Parsed<typeof drugSchema>;
export type WeaponData = Parsed<typeof weaponSchema>;
export type AmmoData = Parsed<typeof ammoSchema>;
export type MiscItemData = Parsed<typeof miscItemSchema>;
export type KeyData = Parsed<typeof keySchema>;
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
