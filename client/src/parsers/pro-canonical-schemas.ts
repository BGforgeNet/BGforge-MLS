/**
 * Zod schemas and TypeScript types for the PRO canonical data model.
 * Shared by pro-canonical-reader.ts and pro-canonical-writer.ts.
 */

import { z } from "zod";
import { zodFieldNumber, zodNumericType } from "./binary-format-contract";

const int32Schema = zodNumericType("int32");
const uint8Schema = zodNumericType("uint8");
const uint16Schema = zodNumericType("uint16");
const uint24Schema = zodNumericType("uint24");
const uint32Schema = zodNumericType("uint32");

const scriptRefSchema = z.strictObject({
    type: z.number().int().min(-1).max(0xFF),
    id: z.number().int().min(-1).max(0x00_FF_FF_FF),
});

const unsignedDamageThresholdSchema = z.strictObject({
    normal: uint32Schema,
    laser: uint32Schema,
    fire: uint32Schema,
    plasma: uint32Schema,
    electrical: uint32Schema,
    emp: uint32Schema,
    explosion: uint32Schema,
});

const unsignedDamageResistanceSchema = z.strictObject({
    normal: uint32Schema,
    laser: uint32Schema,
    fire: uint32Schema,
    plasma: uint32Schema,
    electrical: uint32Schema,
    emp: uint32Schema,
    explosion: uint32Schema,
});

const unsignedCritterDamageResistanceSchema = z.strictObject({
    normal: uint32Schema,
    laser: uint32Schema,
    fire: uint32Schema,
    plasma: uint32Schema,
    electrical: uint32Schema,
    emp: uint32Schema,
    explosive: uint32Schema,
    radiation: uint32Schema,
    poison: uint32Schema,
});

const unsignedPrimaryStatsSchema = z.strictObject({
    strength: uint32Schema,
    perception: uint32Schema,
    endurance: uint32Schema,
    charisma: uint32Schema,
    intelligence: uint32Schema,
    agility: uint32Schema,
    luck: uint32Schema,
});

const signedPrimaryStatsSchema = z.strictObject({
    strength: int32Schema,
    perception: int32Schema,
    endurance: int32Schema,
    charisma: int32Schema,
    intelligence: int32Schema,
    agility: int32Schema,
    luck: int32Schema,
});

const unsignedSecondaryStatsSchema = z.strictObject({
    hitPoints: uint32Schema,
    actionPoints: uint32Schema,
    armorClass: uint32Schema,
    unarmedDamage: uint32Schema,
    meleeDamage: uint32Schema,
    carryWeight: uint32Schema,
    sequence: uint32Schema,
    healingRate: uint32Schema,
    criticalChance: uint32Schema,
    betterCriticals: uint32Schema,
});

const signedSecondaryStatsSchema = z.strictObject({
    hitPoints: int32Schema,
    actionPoints: int32Schema,
    armorClass: int32Schema,
    unarmedDamage: int32Schema,
    meleeDamage: int32Schema,
    carryWeight: int32Schema,
    sequence: int32Schema,
    healingRate: int32Schema,
    criticalChance: int32Schema,
    betterCriticals: int32Schema,
});

const signedCritterDamageThresholdSchema = z.strictObject({
    normal: int32Schema,
    laser: int32Schema,
    fire: int32Schema,
    plasma: int32Schema,
    electrical: int32Schema,
    emp: int32Schema,
    explosive: int32Schema,
});

const signedCritterDamageResistanceSchema = z.strictObject({
    normal: int32Schema,
    laser: int32Schema,
    fire: int32Schema,
    plasma: int32Schema,
    electrical: int32Schema,
    emp: int32Schema,
    explosive: int32Schema,
    radiation: int32Schema,
    poison: int32Schema,
});

const critterPropertiesSchema = z.strictObject({
    flagsExt: uint32Schema,
    script: scriptRefSchema,
    headFrmId: int32Schema,
    aiPacket: uint32Schema,
    teamNumber: uint32Schema,
    critterFlags: uint32Schema,
});

const critterSkillsSchema = z.strictObject({
    skillSmallGuns: int32Schema,
    skillBigGuns: int32Schema,
    skillEnergyWeapons: int32Schema,
    skillUnarmed: int32Schema,
    skillMelee: int32Schema,
    skillThrowing: int32Schema,
    skillFirstAid: int32Schema,
    skillDoctor: int32Schema,
    skillSneak: int32Schema,
    skillLockpick: int32Schema,
    skillSteal: int32Schema,
    skillTraps: int32Schema,
    skillScience: int32Schema,
    skillRepair: int32Schema,
    skillSpeech: int32Schema,
    skillBarter: int32Schema,
    skillGambling: int32Schema,
    skillOutdoorsman: int32Schema,
});

const proCanonicalSectionsSchema = z.strictObject({
    itemProperties: z.strictObject({
        flagsExt: uint24Schema,
        attackModes: uint8Schema,
        script: scriptRefSchema,
        subType: uint32Schema,
        materialId: uint32Schema,
        size: uint32Schema,
        weight: uint32Schema,
        cost: uint32Schema,
        inventoryFrmId: int32Schema,
        soundId: uint8Schema,
    }).optional(),
    armorStats: z.strictObject({
        ac: uint32Schema,
        damageResistance: unsignedDamageResistanceSchema,
        damageThreshold: unsignedDamageThresholdSchema,
        perk: uint32Schema,
        maleFrmId: int32Schema,
        femaleFrmId: int32Schema,
    }).optional(),
    weaponStats: z.strictObject({
        animCode: uint32Schema,
        minDamage: uint32Schema,
        maxDamage: uint32Schema,
        damageType: uint32Schema,
        maxRange1: uint32Schema,
        maxRange2: uint32Schema,
        projectilePid: int32Schema,
        minStrength: uint32Schema,
        apCost1: uint32Schema,
        apCost2: uint32Schema,
        criticalFail: uint32Schema,
        perk: uint32Schema,
        rounds: uint32Schema,
        caliber: uint32Schema,
        ammoPid: int32Schema,
        maxAmmo: uint32Schema,
        soundId: uint8Schema,
    }).optional(),
    ammoStats: z.strictObject({
        caliber: uint32Schema,
        quantity: uint32Schema,
        acModifier: uint32Schema,
        drModifier: uint32Schema,
        damageMultiplier: uint32Schema,
        damageDivisor: uint32Schema,
    }).optional(),
    containerStats: z.strictObject({
        maxSize: uint32Schema,
        openFlags: uint32Schema,
    }).optional(),
    drugStats: z.strictObject({
        affectedStats: z.strictObject({
            stat0: int32Schema,
            stat1: int32Schema,
            stat2: int32Schema,
        }),
        instantEffect: z.strictObject({
            amount0: uint32Schema,
            amount1: uint32Schema,
            amount2: uint32Schema,
        }),
        delayedEffect1: z.strictObject({
            duration: uint32Schema,
            amount0: uint32Schema,
            amount1: uint32Schema,
            amount2: uint32Schema,
        }),
        delayedEffect2: z.strictObject({
            duration: uint32Schema,
            amount0: uint32Schema,
            amount1: uint32Schema,
            amount2: uint32Schema,
        }),
        addiction: z.strictObject({
            rate: uint32Schema,
            effect: uint32Schema,
            onset: uint32Schema,
        }),
    }).optional(),
    miscItemStats: z.strictObject({
        powerPid: int32Schema,
        powerType: uint32Schema,
        charges: uint32Schema,
    }).optional(),
    keyStats: z.strictObject({
        keyCode: uint32Schema,
    }).optional(),
    critterProperties: critterPropertiesSchema.optional(),
    basePrimaryStats: unsignedPrimaryStatsSchema.optional(),
    baseSecondaryStats: unsignedSecondaryStatsSchema.optional(),
    baseDamageThreshold: z.strictObject({
        normal: uint32Schema,
        laser: uint32Schema,
        fire: uint32Schema,
        plasma: uint32Schema,
        electrical: uint32Schema,
        emp: uint32Schema,
        explosive: uint32Schema,
    }).optional(),
    baseDamageResistance: unsignedCritterDamageResistanceSchema.optional(),
    demographics: z.strictObject({
        age: uint32Schema,
        gender: uint32Schema,
    }).optional(),
    bonusPrimaryStats: signedPrimaryStatsSchema.optional(),
    bonusSecondaryStats: signedSecondaryStatsSchema.optional(),
    bonusDamageThreshold: signedCritterDamageThresholdSchema.optional(),
    bonusDamageResistance: signedCritterDamageResistanceSchema.optional(),
    skills: critterSkillsSchema.optional(),
    finalProperties: z.strictObject({
        bodyType: uint32Schema,
        expValue: uint32Schema,
        killType: uint32Schema,
        damageType: uint32Schema,
    }).optional(),
    sceneryProperties: z.strictObject({
        wallLightFlags: uint16Schema,
        actionFlags: uint16Schema,
        script: scriptRefSchema,
        subType: uint32Schema,
        materialId: uint32Schema,
        soundId: uint8Schema,
    }).optional(),
    doorProperties: z.strictObject({
        walkThrough: zodFieldNumber("pro", "pro.doorProperties.walkThrough", "uint32"),
        unknown: uint32Schema,
    }).optional(),
    stairsProperties: z.strictObject({
        destTile: zodFieldNumber("pro", "pro.stairsProperties.destTile", "uint32"),
        destElevation: zodFieldNumber("pro", "pro.stairsProperties.destElevation", "uint32"),
        destMap: uint32Schema,
    }).optional(),
    elevatorProperties: z.strictObject({
        elevatorType: uint32Schema,
        elevatorLevel: uint32Schema,
    }).optional(),
    ladderProperties: z.strictObject({
        destTile: zodFieldNumber("pro", "pro.ladderProperties.destTile", "uint32"),
        destElevation: zodFieldNumber("pro", "pro.ladderProperties.destElevation", "uint32"),
    }).optional(),
    genericProperties: z.strictObject({
        unknown: uint32Schema,
    }).optional(),
    wallProperties: z.strictObject({
        wallLightFlags: uint16Schema,
        actionFlags: uint16Schema,
        script: scriptRefSchema,
        materialId: uint32Schema,
    }).optional(),
    tileProperties: z.strictObject({
        materialId: uint32Schema,
    }).optional(),
    miscProperties: z.strictObject({
        unknown: uint32Schema,
    }).optional(),
});

export const proCanonicalDocumentSchema = z.strictObject({
    header: z.strictObject({
        objectType: uint8Schema,
        objectId: uint24Schema,
        textId: uint32Schema,
        frmType: uint8Schema,
        frmId: uint24Schema,
        lightRadius: zodFieldNumber("pro", "pro.header.lightRadius", "uint32"),
        lightIntensity: zodFieldNumber("pro", "pro.header.lightIntensity", "uint32"),
        flags: uint32Schema,
    }),
    sections: proCanonicalSectionsSchema,
}).superRefine((document, ctx) => {
    const objectType = document.header.objectType;
    const sections = document.sections;

    switch (objectType) {
        case 0:
            if (!sections.itemProperties) {
                ctx.addIssue({ code: "custom", path: ["sections", "itemProperties"], message: "itemProperties is required for item PRO snapshots" });
                break;
            }
            switch (sections.itemProperties.subType) {
                case 0:
                    if (!sections.armorStats) ctx.addIssue({ code: "custom", path: ["sections", "armorStats"], message: "armorStats is required for item subtype 0" });
                    break;
                case 1:
                    if (!sections.containerStats) ctx.addIssue({ code: "custom", path: ["sections", "containerStats"], message: "containerStats is required for item subtype 1" });
                    break;
                case 2:
                    if (!sections.drugStats) ctx.addIssue({ code: "custom", path: ["sections", "drugStats"], message: "drugStats is required for item subtype 2" });
                    break;
                case 3:
                    if (!sections.weaponStats) ctx.addIssue({ code: "custom", path: ["sections", "weaponStats"], message: "weaponStats is required for item subtype 3" });
                    break;
                case 4:
                    if (!sections.ammoStats) ctx.addIssue({ code: "custom", path: ["sections", "ammoStats"], message: "ammoStats is required for item subtype 4" });
                    break;
                case 5:
                    if (!sections.miscItemStats) ctx.addIssue({ code: "custom", path: ["sections", "miscItemStats"], message: "miscItemStats is required for item subtype 5" });
                    break;
                case 6:
                    if (!sections.keyStats) ctx.addIssue({ code: "custom", path: ["sections", "keyStats"], message: "keyStats is required for item subtype 6" });
                    break;
            }
            break;
        case 1:
            for (const requiredSection of ["critterProperties", "basePrimaryStats", "baseSecondaryStats", "baseDamageThreshold", "baseDamageResistance", "demographics", "bonusPrimaryStats", "bonusSecondaryStats", "bonusDamageThreshold", "bonusDamageResistance", "skills", "finalProperties"] as const) {
                if (!sections[requiredSection]) {
                    ctx.addIssue({ code: "custom", path: ["sections", requiredSection], message: `${requiredSection} is required for critter PRO snapshots` });
                }
            }
            break;
        case 2:
            if (!sections.sceneryProperties) {
                ctx.addIssue({ code: "custom", path: ["sections", "sceneryProperties"], message: "sceneryProperties is required for scenery PRO snapshots" });
                break;
            }
            switch (sections.sceneryProperties.subType) {
                case 0:
                    if (!sections.doorProperties) ctx.addIssue({ code: "custom", path: ["sections", "doorProperties"], message: "doorProperties is required for scenery subtype 0" });
                    break;
                case 1:
                    if (!sections.stairsProperties) ctx.addIssue({ code: "custom", path: ["sections", "stairsProperties"], message: "stairsProperties is required for scenery subtype 1" });
                    break;
                case 2:
                    if (!sections.elevatorProperties) ctx.addIssue({ code: "custom", path: ["sections", "elevatorProperties"], message: "elevatorProperties is required for scenery subtype 2" });
                    break;
                case 3:
                case 4:
                    if (!sections.ladderProperties) ctx.addIssue({ code: "custom", path: ["sections", "ladderProperties"], message: "ladderProperties is required for scenery subtype 3/4" });
                    break;
                case 5:
                    if (!sections.genericProperties) ctx.addIssue({ code: "custom", path: ["sections", "genericProperties"], message: "genericProperties is required for scenery subtype 5" });
                    break;
            }
            break;
        case 3:
            if (!sections.wallProperties) ctx.addIssue({ code: "custom", path: ["sections", "wallProperties"], message: "wallProperties is required for wall PRO snapshots" });
            break;
        case 4:
            if (!sections.tileProperties) ctx.addIssue({ code: "custom", path: ["sections", "tileProperties"], message: "tileProperties is required for tile PRO snapshots" });
            break;
        case 5:
            if (!sections.miscProperties) ctx.addIssue({ code: "custom", path: ["sections", "miscProperties"], message: "miscProperties is required for misc PRO snapshots" });
            break;
    }
});

export const proCanonicalSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("pro"),
    formatName: z.string().min(1),
    document: proCanonicalDocumentSchema,
});

export type ProCanonicalSnapshot = z.infer<typeof proCanonicalSnapshotSchema>;
export type ProCanonicalDocument = ProCanonicalSnapshot["document"];
