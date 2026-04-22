import { BufferWriter } from "typed-binary";
import { z } from "zod";
import { clampNumericValue, zodFieldNumber, zodNumericType } from "./binary-format-contract";
import { resolveRawValueFromDisplay } from "./display-lookups";
import { createFieldKey, toSemanticFieldKey } from "./presentation-schema";
import { parseWithSchemaValidation } from "./schema-validation";
import {
    ammoSchema,
    armorSchema,
    containerSchema,
    critterSchema,
    doorSchema,
    drugSchema,
    elevatorSchema,
    genericScenerySchema,
    headerSchema,
    itemCommonSchema,
    keySchema,
    ladderSchema,
    miscItemSchema,
    miscSchema,
    sceneryCommonSchema,
    stairsSchema,
    tileSchema,
    wallSchema,
    weaponSchema,
} from "./pro-schemas";
import {
    CRITTER_BASE_PRIMARY,
    CRITTER_BASE_SECONDARY,
    CRITTER_SIZE,
    CRITTER_SKILLS,
    HEADER_SIZE,
    ITEM_SUBTYPE_OFFSET,
    ITEM_SUBTYPE_SIZES,
    MISC_SIZE,
    SCENERY_SUBTYPE_OFFSET,
    SCENERY_SUBTYPE_SIZES,
    TILE_SIZE,
    WALL_SIZE,
} from "./pro-types";
import type { ParsedField, ParsedGroup, ParseResult } from "./types";

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

const proCanonicalDocumentSchema = z.strictObject({
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

function writer(data: Uint8Array, offset = 0): BufferWriter {
    return new BufferWriter(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

function packScriptId(script: { type: number; id: number }): number {
    if (script.type === -1 && script.id === -1) {
        return 0xFF_FF_FF_FF;
    }
    return ((script.type & 0xFF) << 24) | (script.id & 0x00_FF_FF_FF);
}

function packDestTileAndElevation(destTile: number, destElevation: number): number {
    return ((destElevation & 0x3F) << 26) | (destTile & 0x03_FF_FF_FF);
}

function getGroup(root: ParsedGroup, groupName: string): ParsedGroup {
    const group = root.fields.find((entry): entry is ParsedGroup => "fields" in entry && entry.name === groupName);
    if (!group) {
        throw new Error(`Missing PRO group: ${groupName}`);
    }
    return group;
}

function getOptionalGroup(root: ParsedGroup, groupName: string): ParsedGroup | undefined {
    return root.fields.find((entry): entry is ParsedGroup => "fields" in entry && entry.name === groupName);
}

function getField(group: ParsedGroup, fieldName: string): ParsedField {
    const field = group.fields.find((entry): entry is ParsedField => !("fields" in entry) && entry.name === fieldName);
    if (!field) {
        throw new Error(`Missing PRO field: ${group.name}.${fieldName}`);
    }
    return field;
}

function readFieldNumber(group: ParsedGroup, fieldName: string, fieldPath: string): number {
    const field = getField(group, fieldName);
    const fullFieldPath = `${fieldPath}.${fieldName}`;
    const fieldSegments = [...fieldPath.split("."), fieldName];
    const fieldKey = toSemanticFieldKey("pro", fieldSegments) ?? createFieldKey(fieldSegments);
    if (typeof field.rawValue === "number") {
        return field.rawValue;
    }
    if (typeof field.value === "number") {
        return field.value;
    }
    if (typeof field.value === "string") {
        const lookedUp = resolveRawValueFromDisplay("pro", fieldKey, fieldName, field.value);
        if (lookedUp !== undefined) {
            return lookedUp;
        }
        if (/^0x[0-9a-f]+$/i.test(field.value)) {
            return Number.parseInt(field.value, 16);
        }
        if (/^-?\d+%$/.test(field.value)) {
            return Number.parseInt(field.value, 10);
        }
    }
    throw new Error(`Field is not numeric: ${fullFieldPath}`);
}

function mapGroupFields(group: ParsedGroup, mapping: ReadonlyArray<readonly [fieldName: string, key: string]>): Record<string, number> {
    return Object.fromEntries(mapping.map(([fieldName, key]) => [key, readFieldNumber(group, fieldName, `${group.name}`)]));
}

function readClampedFieldNumber(group: ParsedGroup, fieldName: string, sectionName: string, fieldKey: string, type: string): number {
    return clampNumericValue(readFieldNumber(group, fieldName, sectionName), type, { format: "pro", fieldKey });
}

function rebuildProCanonicalSnapshot(parseResult: ParseResult): ProCanonicalSnapshot {
    const header = getGroup(parseResult.root, "Header");
    const sections: Record<string, unknown> = {};

    const headerData = {
        objectType: readFieldNumber(header, "Object Type", "Header"),
        objectId: readFieldNumber(header, "Object ID", "Header"),
        textId: readFieldNumber(header, "Text ID", "Header"),
        frmType: readFieldNumber(header, "FRM Type", "Header"),
        frmId: readFieldNumber(header, "FRM ID", "Header"),
        lightRadius: readClampedFieldNumber(header, "Light Radius", "Header", "pro.header.lightRadius", "uint32"),
        lightIntensity: readClampedFieldNumber(header, "Light Intensity", "Header", "pro.header.lightIntensity", "uint32"),
        flags: readFieldNumber(header, "Flags", "Header"),
    };

    const itemProperties = getOptionalGroup(parseResult.root, "Item Properties");
    if (itemProperties) {
        sections.itemProperties = {
            flagsExt: readFieldNumber(itemProperties, "Flags Ext", "Item Properties"),
            attackModes: readFieldNumber(itemProperties, "Attack Modes", "Item Properties"),
            script: {
                type: readFieldNumber(itemProperties, "Script Type", "Item Properties"),
                id: readFieldNumber(itemProperties, "Script ID", "Item Properties"),
            },
            subType: readFieldNumber(itemProperties, "Sub Type", "Item Properties"),
            materialId: readFieldNumber(itemProperties, "Material", "Item Properties"),
            size: readFieldNumber(itemProperties, "Size", "Item Properties"),
            weight: readFieldNumber(itemProperties, "Weight", "Item Properties"),
            cost: readFieldNumber(itemProperties, "Cost", "Item Properties"),
            inventoryFrmId: readFieldNumber(itemProperties, "Inventory FRM ID", "Item Properties"),
            soundId: readFieldNumber(itemProperties, "Sound ID", "Item Properties"),
        };
    }

    const armorStats = getOptionalGroup(parseResult.root, "Armor Stats");
    if (armorStats) {
        sections.armorStats = {
            ac: readFieldNumber(armorStats, "AC", "Armor Stats"),
            damageResistance: mapGroupFields(getGroup(armorStats, "Damage Resistance"), [
                ["Normal", "normal"], ["Laser", "laser"], ["Fire", "fire"], ["Plasma", "plasma"], ["Electrical", "electrical"], ["EMP", "emp"], ["Explosion", "explosion"],
            ]),
            damageThreshold: mapGroupFields(getGroup(armorStats, "Damage Threshold"), [
                ["Normal", "normal"], ["Laser", "laser"], ["Fire", "fire"], ["Plasma", "plasma"], ["Electrical", "electrical"], ["EMP", "emp"], ["Explosion", "explosion"],
            ]),
            perk: readFieldNumber(armorStats, "Perk", "Armor Stats"),
            maleFrmId: readFieldNumber(armorStats, "Male FRM ID", "Armor Stats"),
            femaleFrmId: readFieldNumber(armorStats, "Female FRM ID", "Armor Stats"),
        };
    }

    const weaponStats = getOptionalGroup(parseResult.root, "Weapon Stats");
    if (weaponStats) {
        sections.weaponStats = {
            animCode: readFieldNumber(weaponStats, "Animation Code", "Weapon Stats"),
            minDamage: readFieldNumber(weaponStats, "Min Damage", "Weapon Stats"),
            maxDamage: readFieldNumber(weaponStats, "Max Damage", "Weapon Stats"),
            damageType: readFieldNumber(weaponStats, "Damage Type", "Weapon Stats"),
            maxRange1: readFieldNumber(weaponStats, "Max Range 1", "Weapon Stats"),
            maxRange2: readFieldNumber(weaponStats, "Max Range 2", "Weapon Stats"),
            projectilePid: readFieldNumber(weaponStats, "Projectile PID", "Weapon Stats"),
            minStrength: readFieldNumber(weaponStats, "Min Strength", "Weapon Stats"),
            apCost1: readFieldNumber(weaponStats, "AP Cost 1", "Weapon Stats"),
            apCost2: readFieldNumber(weaponStats, "AP Cost 2", "Weapon Stats"),
            criticalFail: readFieldNumber(weaponStats, "Critical Fail", "Weapon Stats"),
            perk: readFieldNumber(weaponStats, "Perk", "Weapon Stats"),
            rounds: readFieldNumber(weaponStats, "Rounds", "Weapon Stats"),
            caliber: readFieldNumber(weaponStats, "Caliber", "Weapon Stats"),
            ammoPid: readFieldNumber(weaponStats, "Ammo PID", "Weapon Stats"),
            maxAmmo: readFieldNumber(weaponStats, "Max Ammo", "Weapon Stats"),
            soundId: readFieldNumber(weaponStats, "Sound ID", "Weapon Stats"),
        };
    }

    const ammoStats = getOptionalGroup(parseResult.root, "Ammo Stats");
    if (ammoStats) {
        sections.ammoStats = {
            caliber: readFieldNumber(ammoStats, "Caliber", "Ammo Stats"),
            quantity: readFieldNumber(ammoStats, "Quantity", "Ammo Stats"),
            acModifier: readFieldNumber(ammoStats, "AC Modifier", "Ammo Stats"),
            drModifier: readFieldNumber(ammoStats, "DR Modifier", "Ammo Stats"),
            damageMultiplier: readFieldNumber(ammoStats, "Damage Multiplier", "Ammo Stats"),
            damageDivisor: readFieldNumber(ammoStats, "Damage Divisor", "Ammo Stats"),
        };
    }

    const containerStats = getOptionalGroup(parseResult.root, "Container Stats");
    if (containerStats) {
        sections.containerStats = {
            maxSize: readFieldNumber(containerStats, "Max Size", "Container Stats"),
            openFlags: readFieldNumber(containerStats, "Open Flags", "Container Stats"),
        };
    }

    const drugStats = getOptionalGroup(parseResult.root, "Drug Stats");
    if (drugStats) {
        sections.drugStats = {
            affectedStats: mapGroupFields(getGroup(drugStats, "Affected Stats"), [["Stat 0", "stat0"], ["Stat 1", "stat1"], ["Stat 2", "stat2"]]),
            instantEffect: mapGroupFields(getGroup(drugStats, "Instant Effect"), [["Amount 0", "amount0"], ["Amount 1", "amount1"], ["Amount 2", "amount2"]]),
            delayedEffect1: mapGroupFields(getGroup(drugStats, "Delayed Effect 1"), [["Duration", "duration"], ["Amount 0", "amount0"], ["Amount 1", "amount1"], ["Amount 2", "amount2"]]),
            delayedEffect2: mapGroupFields(getGroup(drugStats, "Delayed Effect 2"), [["Duration", "duration"], ["Amount 0", "amount0"], ["Amount 1", "amount1"], ["Amount 2", "amount2"]]),
            addiction: mapGroupFields(getGroup(drugStats, "Addiction"), [["Rate", "rate"], ["Effect", "effect"], ["Onset", "onset"]]),
        };
    }

    const miscItemStats = getOptionalGroup(parseResult.root, "Misc Item Stats");
    if (miscItemStats) {
        sections.miscItemStats = {
            powerPid: readFieldNumber(miscItemStats, "Power PID", "Misc Item Stats"),
            powerType: readFieldNumber(miscItemStats, "Power Type", "Misc Item Stats"),
            charges: readFieldNumber(miscItemStats, "Charges", "Misc Item Stats"),
        };
    }

    const keyStats = getOptionalGroup(parseResult.root, "Key Stats");
    if (keyStats) {
        sections.keyStats = {
            keyCode: readFieldNumber(keyStats, "Key Code", "Key Stats"),
        };
    }

    const critterProperties = getOptionalGroup(parseResult.root, "Critter Properties");
    if (critterProperties) {
        sections.critterProperties = {
            flagsExt: readFieldNumber(critterProperties, "Flags Ext", "Critter Properties"),
            script: {
                type: readFieldNumber(critterProperties, "Script Type", "Critter Properties"),
                id: readFieldNumber(critterProperties, "Script ID", "Critter Properties"),
            },
            headFrmId: readFieldNumber(critterProperties, "Head FRM ID", "Critter Properties"),
            aiPacket: readFieldNumber(critterProperties, "AI Packet", "Critter Properties"),
            teamNumber: readFieldNumber(critterProperties, "Team Number", "Critter Properties"),
            critterFlags: readFieldNumber(critterProperties, "Critter Flags", "Critter Properties"),
        };
    }

    const basePrimaryStats = getOptionalGroup(parseResult.root, "Base Primary Stats");
    if (basePrimaryStats) {
        sections.basePrimaryStats = Object.fromEntries(CRITTER_BASE_PRIMARY.map(([displayName, dataKey]) => [dataKey, readFieldNumber(basePrimaryStats, displayName, "Base Primary Stats")]));
    }

    const baseSecondaryStats = getOptionalGroup(parseResult.root, "Base Secondary Stats");
    if (baseSecondaryStats) {
        sections.baseSecondaryStats = Object.fromEntries(CRITTER_BASE_SECONDARY.map(([displayName, dataKey]) => [dataKey, readFieldNumber(baseSecondaryStats, displayName, "Base Secondary Stats")]));
    }

    const baseDamageThreshold = getOptionalGroup(parseResult.root, "Base Damage Threshold");
    if (baseDamageThreshold) {
        sections.baseDamageThreshold = mapGroupFields(baseDamageThreshold, [
            ["Normal", "normal"], ["Laser", "laser"], ["Fire", "fire"], ["Plasma", "plasma"], ["Electrical", "electrical"], ["EMP", "emp"], ["Explosive", "explosive"],
        ]);
    }

    const baseDamageResistance = getOptionalGroup(parseResult.root, "Base Damage Resistance");
    if (baseDamageResistance) {
        sections.baseDamageResistance = mapGroupFields(baseDamageResistance, [
            ["Normal", "normal"], ["Laser", "laser"], ["Fire", "fire"], ["Plasma", "plasma"], ["Electrical", "electrical"], ["EMP", "emp"], ["Explosive", "explosive"], ["Radiation", "radiation"], ["Poison", "poison"],
        ]);
    }

    const bonusPrimaryStats = getOptionalGroup(parseResult.root, "Bonus Primary Stats");
    if (bonusPrimaryStats) {
        sections.bonusPrimaryStats = mapGroupFields(bonusPrimaryStats, [
            ["Strength", "strength"], ["Perception", "perception"], ["Endurance", "endurance"], ["Charisma", "charisma"], ["Intelligence", "intelligence"], ["Agility", "agility"], ["Luck", "luck"],
        ]);
    }

    const bonusSecondaryStats = getOptionalGroup(parseResult.root, "Bonus Secondary Stats");
    if (bonusSecondaryStats) {
        sections.bonusSecondaryStats = mapGroupFields(bonusSecondaryStats, [
            ["Hit Points", "hitPoints"], ["Action Points", "actionPoints"], ["Armor Class", "armorClass"], ["Unarmed Damage", "unarmedDamage"], ["Melee Damage", "meleeDamage"], ["Carry Weight", "carryWeight"], ["Sequence", "sequence"], ["Healing Rate", "healingRate"], ["Critical Chance", "criticalChance"], ["Better Criticals", "betterCriticals"],
        ]);
    }

    const bonusDamageThreshold = getOptionalGroup(parseResult.root, "Bonus Damage Threshold");
    if (bonusDamageThreshold) {
        sections.bonusDamageThreshold = mapGroupFields(bonusDamageThreshold, [
            ["Normal", "normal"], ["Laser", "laser"], ["Fire", "fire"], ["Plasma", "plasma"], ["Electrical", "electrical"], ["EMP", "emp"], ["Explosive", "explosive"],
        ]);
    }

    const bonusDamageResistance = getOptionalGroup(parseResult.root, "Bonus Damage Resistance");
    if (bonusDamageResistance) {
        sections.bonusDamageResistance = mapGroupFields(bonusDamageResistance, [
            ["Normal", "normal"], ["Laser", "laser"], ["Fire", "fire"], ["Plasma", "plasma"], ["Electrical", "electrical"], ["EMP", "emp"], ["Explosive", "explosive"], ["Radiation", "radiation"], ["Poison", "poison"],
        ]);
    }

    const skills = getOptionalGroup(parseResult.root, "Skills");
    if (skills) {
        sections.skills = Object.fromEntries(CRITTER_SKILLS.map(([displayName, dataKey]) => [dataKey, readFieldNumber(skills, displayName, "Skills")]));
    }

    const demographics = getOptionalGroup(parseResult.root, "Demographics");
    if (demographics) {
        sections.demographics = {
            age: readFieldNumber(demographics, "Age", "Demographics"),
            gender: readFieldNumber(demographics, "Gender", "Demographics"),
        };
    }

    const finalProperties = getOptionalGroup(parseResult.root, "Final Properties");
    if (finalProperties) {
        sections.finalProperties = {
            bodyType: readFieldNumber(finalProperties, "Body Type", "Final Properties"),
            expValue: readFieldNumber(finalProperties, "Experience Value", "Final Properties"),
            killType: readFieldNumber(finalProperties, "Kill Type", "Final Properties"),
            damageType: readFieldNumber(finalProperties, "Damage Type", "Final Properties"),
        };
    }

    const sceneryProperties = getOptionalGroup(parseResult.root, "Scenery Properties");
    if (sceneryProperties) {
        sections.sceneryProperties = {
            wallLightFlags: readFieldNumber(sceneryProperties, "Wall Light Flags", "Scenery Properties"),
            actionFlags: readFieldNumber(sceneryProperties, "Action Flags", "Scenery Properties"),
            script: {
                type: readFieldNumber(sceneryProperties, "Script Type", "Scenery Properties"),
                id: readFieldNumber(sceneryProperties, "Script ID", "Scenery Properties"),
            },
            subType: readFieldNumber(sceneryProperties, "Sub Type", "Scenery Properties"),
            materialId: readFieldNumber(sceneryProperties, "Material", "Scenery Properties"),
            soundId: readFieldNumber(sceneryProperties, "Sound ID", "Scenery Properties"),
        };
    }

    const doorProperties = getOptionalGroup(parseResult.root, "Door Properties");
    if (doorProperties) {
        sections.doorProperties = {
            walkThrough: readClampedFieldNumber(
                doorProperties,
                "Walk Through",
                "Door Properties",
                "pro.doorProperties.walkThrough",
                "uint32"
            ),
            unknown: readFieldNumber(doorProperties, "Unknown", "Door Properties"),
        };
    }

    const stairsProperties = getOptionalGroup(parseResult.root, "Stairs Properties");
    if (stairsProperties) {
        sections.stairsProperties = {
            destTile: readClampedFieldNumber(
                stairsProperties,
                "Dest Tile",
                "Stairs Properties",
                "pro.stairsProperties.destTile",
                "uint32"
            ),
            destElevation: readClampedFieldNumber(
                stairsProperties,
                "Dest Elevation",
                "Stairs Properties",
                "pro.stairsProperties.destElevation",
                "uint32"
            ),
            destMap: readFieldNumber(stairsProperties, "Dest Map", "Stairs Properties"),
        };
    }

    const elevatorProperties = getOptionalGroup(parseResult.root, "Elevator Properties");
    if (elevatorProperties) {
        sections.elevatorProperties = {
            elevatorType: readFieldNumber(elevatorProperties, "Elevator Type", "Elevator Properties"),
            elevatorLevel: readFieldNumber(elevatorProperties, "Elevator Level", "Elevator Properties"),
        };
    }

    const ladderProperties = getOptionalGroup(parseResult.root, "Ladder Properties");
    if (ladderProperties) {
        sections.ladderProperties = {
            destTile: readClampedFieldNumber(
                ladderProperties,
                "Dest Tile",
                "Ladder Properties",
                "pro.ladderProperties.destTile",
                "uint32"
            ),
            destElevation: readClampedFieldNumber(
                ladderProperties,
                "Dest Elevation",
                "Ladder Properties",
                "pro.ladderProperties.destElevation",
                "uint32"
            ),
        };
    }

    const genericProperties = getOptionalGroup(parseResult.root, "Generic Properties");
    if (genericProperties) {
        sections.genericProperties = {
            unknown: readFieldNumber(genericProperties, "Unknown", "Generic Properties"),
        };
    }

    const wallProperties = getOptionalGroup(parseResult.root, "Wall Properties");
    if (wallProperties) {
        sections.wallProperties = {
            wallLightFlags: readFieldNumber(wallProperties, "Wall Light Flags", "Wall Properties"),
            actionFlags: readFieldNumber(wallProperties, "Action Flags", "Wall Properties"),
            script: {
                type: readFieldNumber(wallProperties, "Script Type", "Wall Properties"),
                id: readFieldNumber(wallProperties, "Script ID", "Wall Properties"),
            },
            materialId: readFieldNumber(wallProperties, "Material", "Wall Properties"),
        };
    }

    const tileProperties = getOptionalGroup(parseResult.root, "Tile Properties");
    if (tileProperties) {
        sections.tileProperties = {
            materialId: readFieldNumber(tileProperties, "Material", "Tile Properties"),
        };
    }

    const miscProperties = getOptionalGroup(parseResult.root, "Misc Properties");
    if (miscProperties) {
        sections.miscProperties = {
            unknown: readFieldNumber(miscProperties, "Unknown", "Misc Properties"),
        };
    }

    return parseWithSchemaValidation(proCanonicalSnapshotSchema, {
        schemaVersion: 1,
        format: "pro",
        formatName: parseResult.formatName,
        document: {
            header: headerData,
            sections,
        },
    }, "Invalid PRO canonical snapshot");
}

export function createProCanonicalSnapshot(parseResult: ParseResult): ProCanonicalSnapshot {
    const embeddedDocument = getProCanonicalDocument(parseResult);
    if (embeddedDocument) {
        return parseWithSchemaValidation(proCanonicalSnapshotSchema, {
            schemaVersion: 1,
            format: "pro",
            formatName: parseResult.formatName,
            document: embeddedDocument,
        }, "Invalid PRO canonical document");
    }

    return rebuildProCanonicalSnapshot(parseResult);
}

export function rebuildProCanonicalDocument(parseResult: ParseResult): ProCanonicalDocument {
    return rebuildProCanonicalSnapshot(parseResult).document;
}

export function serializeProCanonicalSnapshot(snapshot: ProCanonicalSnapshot): Uint8Array {
    const { header, sections } = snapshot.document;
    let size = HEADER_SIZE;

    switch (header.objectType) {
        case 0:
            if (!sections.itemProperties) throw new Error("itemProperties is required");
            size = ITEM_SUBTYPE_OFFSET + (ITEM_SUBTYPE_SIZES[sections.itemProperties.subType] ?? 0);
            break;
        case 1:
            size = CRITTER_SIZE;
            break;
        case 2:
            if (!sections.sceneryProperties) throw new Error("sceneryProperties is required");
            size = SCENERY_SUBTYPE_OFFSET + (SCENERY_SUBTYPE_SIZES[sections.sceneryProperties.subType] ?? 0);
            break;
        case 3:
            size = WALL_SIZE;
            break;
        case 4:
            size = TILE_SIZE;
            break;
        case 5:
            size = MISC_SIZE;
            break;
    }

    const data = new Uint8Array(size);
    headerSchema.write(writer(data), {
        objectTypeAndId: ((header.objectType & 0xFF) << 24) | (header.objectId & 0x00_FF_FF_FF),
        textId: header.textId,
        frmTypeAndId: ((header.frmType & 0xFF) << 24) | (header.frmId & 0x00_FF_FF_FF),
        lightRadius: header.lightRadius,
        lightIntensity: header.lightIntensity,
        flags: header.flags,
    });

    switch (header.objectType) {
        case 0: {
            const item = sections.itemProperties!;
            itemCommonSchema.write(writer(data, HEADER_SIZE), {
                flagsExt: item.flagsExt,
                attackModes: item.attackModes,
                scriptId: packScriptId(item.script),
                subType: item.subType,
                materialId: item.materialId,
                size: item.size,
                weight: item.weight,
                cost: item.cost,
                inventoryFrmId: item.inventoryFrmId,
                soundId: item.soundId,
            });
            switch (item.subType) {
                case 0: {
                    const armor = sections.armorStats!;
                    armorSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), {
                        ac: armor.ac,
                        drNormal: armor.damageResistance.normal,
                        drLaser: armor.damageResistance.laser,
                        drFire: armor.damageResistance.fire,
                        drPlasma: armor.damageResistance.plasma,
                        drElectrical: armor.damageResistance.electrical,
                        drEmp: armor.damageResistance.emp,
                        drExplosion: armor.damageResistance.explosion,
                        dtNormal: armor.damageThreshold.normal,
                        dtLaser: armor.damageThreshold.laser,
                        dtFire: armor.damageThreshold.fire,
                        dtPlasma: armor.damageThreshold.plasma,
                        dtElectrical: armor.damageThreshold.electrical,
                        dtEmp: armor.damageThreshold.emp,
                        dtExplosion: armor.damageThreshold.explosion,
                        perk: armor.perk,
                        maleFrmId: armor.maleFrmId,
                        femaleFrmId: armor.femaleFrmId,
                    });
                    break;
                }
                case 1:
                    containerSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.containerStats!);
                    break;
                case 2: {
                    const drug = sections.drugStats!;
                    drugSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), {
                        stat0: drug.affectedStats.stat0,
                        stat1: drug.affectedStats.stat1,
                        stat2: drug.affectedStats.stat2,
                        amount0Instant: drug.instantEffect.amount0,
                        amount1Instant: drug.instantEffect.amount1,
                        amount2Instant: drug.instantEffect.amount2,
                        duration1: drug.delayedEffect1.duration,
                        amount0Delayed1: drug.delayedEffect1.amount0,
                        amount1Delayed1: drug.delayedEffect1.amount1,
                        amount2Delayed1: drug.delayedEffect1.amount2,
                        duration2: drug.delayedEffect2.duration,
                        amount0Delayed2: drug.delayedEffect2.amount0,
                        amount1Delayed2: drug.delayedEffect2.amount1,
                        amount2Delayed2: drug.delayedEffect2.amount2,
                        addictionRate: drug.addiction.rate,
                        addictionEffect: drug.addiction.effect,
                        addictionOnset: drug.addiction.onset,
                    });
                    break;
                }
                case 3:
                    weaponSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.weaponStats!);
                    break;
                case 4:
                    ammoSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.ammoStats!);
                    break;
                case 5:
                    miscItemSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.miscItemStats!);
                    break;
                case 6:
                    keySchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.keyStats!);
                    break;
            }
            break;
        }
        case 1: {
            const props = sections.critterProperties!;
            const demographics = sections.demographics!;
            const finalProperties = sections.finalProperties!;
            critterSchema.write(writer(data, HEADER_SIZE), {
                flagsExt: props.flagsExt,
                scriptId: packScriptId(props.script),
                headFrmId: props.headFrmId,
                aiPacket: props.aiPacket,
                teamNumber: props.teamNumber,
                critterFlags: props.critterFlags,
                ...sections.basePrimaryStats!,
                ...sections.baseSecondaryStats!,
                dtNormal: sections.baseDamageThreshold!.normal,
                dtLaser: sections.baseDamageThreshold!.laser,
                dtFire: sections.baseDamageThreshold!.fire,
                dtPlasma: sections.baseDamageThreshold!.plasma,
                dtElectrical: sections.baseDamageThreshold!.electrical,
                dtEmp: sections.baseDamageThreshold!.emp,
                dtExplosive: sections.baseDamageThreshold!.explosive,
                drNormal: sections.baseDamageResistance!.normal,
                drLaser: sections.baseDamageResistance!.laser,
                drFire: sections.baseDamageResistance!.fire,
                drPlasma: sections.baseDamageResistance!.plasma,
                drElectrical: sections.baseDamageResistance!.electrical,
                drEmp: sections.baseDamageResistance!.emp,
                drExplosive: sections.baseDamageResistance!.explosive,
                drRadiation: sections.baseDamageResistance!.radiation,
                drPoison: sections.baseDamageResistance!.poison,
                age: demographics.age,
                gender: demographics.gender,
                strengthBonus: sections.bonusPrimaryStats!.strength,
                perceptionBonus: sections.bonusPrimaryStats!.perception,
                enduranceBonus: sections.bonusPrimaryStats!.endurance,
                charismaBonus: sections.bonusPrimaryStats!.charisma,
                intelligenceBonus: sections.bonusPrimaryStats!.intelligence,
                agilityBonus: sections.bonusPrimaryStats!.agility,
                luckBonus: sections.bonusPrimaryStats!.luck,
                hitPointsBonus: sections.bonusSecondaryStats!.hitPoints,
                actionPointsBonus: sections.bonusSecondaryStats!.actionPoints,
                armorClassBonus: sections.bonusSecondaryStats!.armorClass,
                unarmedDamageBonus: sections.bonusSecondaryStats!.unarmedDamage,
                meleeDamageBonus: sections.bonusSecondaryStats!.meleeDamage,
                carryWeightBonus: sections.bonusSecondaryStats!.carryWeight,
                sequenceBonus: sections.bonusSecondaryStats!.sequence,
                healingRateBonus: sections.bonusSecondaryStats!.healingRate,
                criticalChanceBonus: sections.bonusSecondaryStats!.criticalChance,
                betterCriticalsBonus: sections.bonusSecondaryStats!.betterCriticals,
                dtNormalBonus: sections.bonusDamageThreshold!.normal,
                dtLaserBonus: sections.bonusDamageThreshold!.laser,
                dtFireBonus: sections.bonusDamageThreshold!.fire,
                dtPlasmaBonus: sections.bonusDamageThreshold!.plasma,
                dtElectricalBonus: sections.bonusDamageThreshold!.electrical,
                dtEmpBonus: sections.bonusDamageThreshold!.emp,
                dtExplosiveBonus: sections.bonusDamageThreshold!.explosive,
                drNormalBonus: sections.bonusDamageResistance!.normal,
                drLaserBonus: sections.bonusDamageResistance!.laser,
                drFireBonus: sections.bonusDamageResistance!.fire,
                drPlasmaBonus: sections.bonusDamageResistance!.plasma,
                drElectricalBonus: sections.bonusDamageResistance!.electrical,
                drEmpBonus: sections.bonusDamageResistance!.emp,
                drExplosiveBonus: sections.bonusDamageResistance!.explosive,
                drRadiationBonus: sections.bonusDamageResistance!.radiation,
                drPoisonBonus: sections.bonusDamageResistance!.poison,
                ageBonus: 0,
                genderBonus: 0,
                ...sections.skills!,
                bodyType: finalProperties.bodyType,
                expValue: finalProperties.expValue,
                killType: finalProperties.killType,
                damageType: finalProperties.damageType,
            });
            break;
        }
        case 2: {
            const scenery = sections.sceneryProperties!;
            sceneryCommonSchema.write(writer(data, HEADER_SIZE), {
                wallLightFlags: scenery.wallLightFlags,
                actionFlags: scenery.actionFlags,
                scriptId: packScriptId(scenery.script),
                subType: scenery.subType,
                materialId: scenery.materialId,
                soundId: scenery.soundId,
            });
            switch (scenery.subType) {
                case 0:
                    doorSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), {
                        walkThruFlag: sections.doorProperties!.walkThrough,
                        unknown: sections.doorProperties!.unknown,
                    });
                    break;
                case 1:
                    stairsSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), {
                        destTileAndElevation: packDestTileAndElevation(sections.stairsProperties!.destTile, sections.stairsProperties!.destElevation),
                        destMap: sections.stairsProperties!.destMap,
                    });
                    break;
                case 2:
                    elevatorSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), sections.elevatorProperties!);
                    break;
                case 3:
                case 4:
                    ladderSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), {
                        destTileAndElevation: packDestTileAndElevation(sections.ladderProperties!.destTile, sections.ladderProperties!.destElevation),
                    });
                    break;
                case 5:
                    genericScenerySchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), sections.genericProperties!);
                    break;
            }
            break;
        }
        case 3: {
            const wall = sections.wallProperties!;
            wallSchema.write(writer(data, HEADER_SIZE), {
                wallLightFlags: wall.wallLightFlags,
                actionFlags: wall.actionFlags,
                scriptId: packScriptId(wall.script),
                materialId: wall.materialId,
            });
            break;
        }
        case 4:
            tileSchema.write(writer(data, HEADER_SIZE), sections.tileProperties!);
            break;
        case 5:
            miscSchema.write(writer(data, HEADER_SIZE), sections.miscProperties!);
            break;
    }

    return data;
}

export function serializeProCanonicalDocument(document: ProCanonicalDocument, formatName = "Fallout PRO (Prototype)"): Uint8Array {
    return serializeProCanonicalSnapshot(parseWithSchemaValidation(proCanonicalSnapshotSchema, {
        schemaVersion: 1,
        format: "pro",
        formatName,
        document,
    }, "Invalid PRO canonical document"));
}

export function getProCanonicalDocument(parseResult: ParseResult): ProCanonicalDocument | undefined {
    const parsed = proCanonicalDocumentSchema.safeParse(parseResult.document);
    return parsed.success ? parsed.data : undefined;
}
