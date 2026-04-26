import { u32, i8, i32 } from "typed-binary";
import { i24 } from "../../spec/codec-meta";
import { CritterFlags, BodyType, KillType, DamageType, ScriptType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";

/**
 * Wire spec for the PRO critter section. Flat shape — the data IS flat in the
 * file format. The canonical document used to nest these into named sub-objects
 * (basePrimaryStats, baseSecondaryStats, baseDamageThreshold, baseDamageResistance,
 * bonusPrimaryStats, bonusSecondaryStats, bonusDamageThreshold,
 * bonusDamageResistance, demographics, skills, critterProperties, finalProperties)
 * for cosmetic readability; that nesting has been flattened so the canonical
 * schema matches the wire format.
 */
export const critterSpec = {
    flagsExt: { codec: u32 },
    scriptType: { codec: i8, enum: ScriptType },
    scriptId: { codec: i24 },
    headFrmId: { codec: i32 },
    aiPacket: { codec: u32 },
    teamNumber: { codec: u32 },
    critterFlags: { codec: u32, flags: CritterFlags },
    // Base primary stats
    strength: { codec: u32 },
    perception: { codec: u32 },
    endurance: { codec: u32 },
    charisma: { codec: u32 },
    intelligence: { codec: u32 },
    agility: { codec: u32 },
    luck: { codec: u32 },
    // Base secondary stats
    hitPoints: { codec: u32 },
    actionPoints: { codec: u32 },
    armorClass: { codec: u32 },
    unarmedDamage: { codec: u32 },
    meleeDamage: { codec: u32 },
    carryWeight: { codec: u32 },
    sequence: { codec: u32 },
    healingRate: { codec: u32 },
    criticalChance: { codec: u32 },
    betterCriticals: { codec: u32 },
    // Base damage thresholds
    dtNormal: { codec: u32 },
    dtLaser: { codec: u32 },
    dtFire: { codec: u32 },
    dtPlasma: { codec: u32 },
    dtElectrical: { codec: u32 },
    dtEmp: { codec: u32 },
    dtExplosive: { codec: u32 },
    // Base damage resistances
    drNormal: { codec: u32 },
    drLaser: { codec: u32 },
    drFire: { codec: u32 },
    drPlasma: { codec: u32 },
    drElectrical: { codec: u32 },
    drEmp: { codec: u32 },
    drExplosive: { codec: u32 },
    drRadiation: { codec: u32 },
    drPoison: { codec: u32 },
    // Demographics
    age: { codec: u32 },
    gender: { codec: u32 },
    // Bonus primary stats
    strengthBonus: { codec: i32 },
    perceptionBonus: { codec: i32 },
    enduranceBonus: { codec: i32 },
    charismaBonus: { codec: i32 },
    intelligenceBonus: { codec: i32 },
    agilityBonus: { codec: i32 },
    luckBonus: { codec: i32 },
    // Bonus secondary stats
    hitPointsBonus: { codec: i32 },
    actionPointsBonus: { codec: i32 },
    armorClassBonus: { codec: i32 },
    unarmedDamageBonus: { codec: i32 },
    meleeDamageBonus: { codec: i32 },
    carryWeightBonus: { codec: i32 },
    sequenceBonus: { codec: i32 },
    healingRateBonus: { codec: i32 },
    criticalChanceBonus: { codec: i32 },
    betterCriticalsBonus: { codec: i32 },
    // Bonus damage thresholds
    dtNormalBonus: { codec: i32 },
    dtLaserBonus: { codec: i32 },
    dtFireBonus: { codec: i32 },
    dtPlasmaBonus: { codec: i32 },
    dtElectricalBonus: { codec: i32 },
    dtEmpBonus: { codec: i32 },
    dtExplosiveBonus: { codec: i32 },
    // Bonus damage resistances
    drNormalBonus: { codec: i32 },
    drLaserBonus: { codec: i32 },
    drFireBonus: { codec: i32 },
    drPlasmaBonus: { codec: i32 },
    drElectricalBonus: { codec: i32 },
    drEmpBonus: { codec: i32 },
    drExplosiveBonus: { codec: i32 },
    drRadiationBonus: { codec: i32 },
    drPoisonBonus: { codec: i32 },
    // Bonus demographics
    ageBonus: { codec: i32 },
    genderBonus: { codec: i32 },
    // Skills
    skillSmallGuns: { codec: i32 },
    skillBigGuns: { codec: i32 },
    skillEnergyWeapons: { codec: i32 },
    skillUnarmed: { codec: i32 },
    skillMelee: { codec: i32 },
    skillThrowing: { codec: i32 },
    skillFirstAid: { codec: i32 },
    skillDoctor: { codec: i32 },
    skillSneak: { codec: i32 },
    skillLockpick: { codec: i32 },
    skillSteal: { codec: i32 },
    skillTraps: { codec: i32 },
    skillScience: { codec: i32 },
    skillRepair: { codec: i32 },
    skillSpeech: { codec: i32 },
    skillBarter: { codec: i32 },
    skillGambling: { codec: i32 },
    skillOutdoorsman: { codec: i32 },
    // Final fields
    bodyType: { codec: u32, enum: BodyType },
    expValue: { codec: u32 },
    killType: { codec: u32, enum: KillType },
    damageType: { codec: u32, enum: DamageType },
} satisfies Record<string, FieldSpec>;

export type CritterData = SpecData<typeof critterSpec>;
