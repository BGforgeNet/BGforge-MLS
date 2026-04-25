/**
 * Reader helpers for rebuilding ProCanonicalSnapshot/ProCanonicalDocument
 * from a parsed display tree (ParseResult).
 */

import { clampNumericValue } from "../binary-format-contract";
import { resolveRawValueFromDisplay } from "../display-lookups";
import { createFieldKey, toSemanticFieldKey } from "../presentation-schema";
import { parseWithSchemaValidation } from "../schema-validation";
import { CRITTER_BASE_PRIMARY, CRITTER_BASE_SECONDARY, CRITTER_SKILLS } from "./types";
import type { ParsedField, ParsedGroup, ParseResult } from "../types";
import {
    proCanonicalSnapshotSchema,
    proCanonicalDocumentSchema,
    type ProCanonicalSnapshot,
    type ProCanonicalDocument,
} from "./canonical-schemas";

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

function mapGroupFields(
    group: ParsedGroup,
    mapping: ReadonlyArray<readonly [fieldName: string, key: string]>,
): Record<string, number> {
    return Object.fromEntries(
        mapping.map(([fieldName, key]) => [key, readFieldNumber(group, fieldName, `${group.name}`)]),
    );
}

function readClampedFieldNumber(
    group: ParsedGroup,
    fieldName: string,
    sectionName: string,
    fieldKey: string,
    type: string,
): number {
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
        lightIntensity: readClampedFieldNumber(
            header,
            "Light Intensity",
            "Header",
            "pro.header.lightIntensity",
            "uint32",
        ),
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
                ["Normal", "normal"],
                ["Laser", "laser"],
                ["Fire", "fire"],
                ["Plasma", "plasma"],
                ["Electrical", "electrical"],
                ["EMP", "emp"],
                ["Explosion", "explosion"],
            ]),
            damageThreshold: mapGroupFields(getGroup(armorStats, "Damage Threshold"), [
                ["Normal", "normal"],
                ["Laser", "laser"],
                ["Fire", "fire"],
                ["Plasma", "plasma"],
                ["Electrical", "electrical"],
                ["EMP", "emp"],
                ["Explosion", "explosion"],
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
            affectedStats: mapGroupFields(getGroup(drugStats, "Affected Stats"), [
                ["Stat 0", "stat0"],
                ["Stat 1", "stat1"],
                ["Stat 2", "stat2"],
            ]),
            instantEffect: mapGroupFields(getGroup(drugStats, "Instant Effect"), [
                ["Amount 0", "amount0"],
                ["Amount 1", "amount1"],
                ["Amount 2", "amount2"],
            ]),
            delayedEffect1: mapGroupFields(getGroup(drugStats, "Delayed Effect 1"), [
                ["Duration", "duration"],
                ["Amount 0", "amount0"],
                ["Amount 1", "amount1"],
                ["Amount 2", "amount2"],
            ]),
            delayedEffect2: mapGroupFields(getGroup(drugStats, "Delayed Effect 2"), [
                ["Duration", "duration"],
                ["Amount 0", "amount0"],
                ["Amount 1", "amount1"],
                ["Amount 2", "amount2"],
            ]),
            addiction: mapGroupFields(getGroup(drugStats, "Addiction"), [
                ["Rate", "rate"],
                ["Effect", "effect"],
                ["Onset", "onset"],
            ]),
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
        sections.basePrimaryStats = Object.fromEntries(
            CRITTER_BASE_PRIMARY.map(([displayName, dataKey]) => [
                dataKey,
                readFieldNumber(basePrimaryStats, displayName, "Base Primary Stats"),
            ]),
        );
    }

    const baseSecondaryStats = getOptionalGroup(parseResult.root, "Base Secondary Stats");
    if (baseSecondaryStats) {
        sections.baseSecondaryStats = Object.fromEntries(
            CRITTER_BASE_SECONDARY.map(([displayName, dataKey]) => [
                dataKey,
                readFieldNumber(baseSecondaryStats, displayName, "Base Secondary Stats"),
            ]),
        );
    }

    const baseDamageThreshold = getOptionalGroup(parseResult.root, "Base Damage Threshold");
    if (baseDamageThreshold) {
        sections.baseDamageThreshold = mapGroupFields(baseDamageThreshold, [
            ["Normal", "normal"],
            ["Laser", "laser"],
            ["Fire", "fire"],
            ["Plasma", "plasma"],
            ["Electrical", "electrical"],
            ["EMP", "emp"],
            ["Explosive", "explosive"],
        ]);
    }

    const baseDamageResistance = getOptionalGroup(parseResult.root, "Base Damage Resistance");
    if (baseDamageResistance) {
        sections.baseDamageResistance = mapGroupFields(baseDamageResistance, [
            ["Normal", "normal"],
            ["Laser", "laser"],
            ["Fire", "fire"],
            ["Plasma", "plasma"],
            ["Electrical", "electrical"],
            ["EMP", "emp"],
            ["Explosive", "explosive"],
            ["Radiation", "radiation"],
            ["Poison", "poison"],
        ]);
    }

    const bonusPrimaryStats = getOptionalGroup(parseResult.root, "Bonus Primary Stats");
    if (bonusPrimaryStats) {
        sections.bonusPrimaryStats = mapGroupFields(bonusPrimaryStats, [
            ["Strength", "strength"],
            ["Perception", "perception"],
            ["Endurance", "endurance"],
            ["Charisma", "charisma"],
            ["Intelligence", "intelligence"],
            ["Agility", "agility"],
            ["Luck", "luck"],
        ]);
    }

    const bonusSecondaryStats = getOptionalGroup(parseResult.root, "Bonus Secondary Stats");
    if (bonusSecondaryStats) {
        sections.bonusSecondaryStats = mapGroupFields(bonusSecondaryStats, [
            ["Hit Points", "hitPoints"],
            ["Action Points", "actionPoints"],
            ["Armor Class", "armorClass"],
            ["Unarmed Damage", "unarmedDamage"],
            ["Melee Damage", "meleeDamage"],
            ["Carry Weight", "carryWeight"],
            ["Sequence", "sequence"],
            ["Healing Rate", "healingRate"],
            ["Critical Chance", "criticalChance"],
            ["Better Criticals", "betterCriticals"],
        ]);
    }

    const bonusDamageThreshold = getOptionalGroup(parseResult.root, "Bonus Damage Threshold");
    if (bonusDamageThreshold) {
        sections.bonusDamageThreshold = mapGroupFields(bonusDamageThreshold, [
            ["Normal", "normal"],
            ["Laser", "laser"],
            ["Fire", "fire"],
            ["Plasma", "plasma"],
            ["Electrical", "electrical"],
            ["EMP", "emp"],
            ["Explosive", "explosive"],
        ]);
    }

    const bonusDamageResistance = getOptionalGroup(parseResult.root, "Bonus Damage Resistance");
    if (bonusDamageResistance) {
        sections.bonusDamageResistance = mapGroupFields(bonusDamageResistance, [
            ["Normal", "normal"],
            ["Laser", "laser"],
            ["Fire", "fire"],
            ["Plasma", "plasma"],
            ["Electrical", "electrical"],
            ["EMP", "emp"],
            ["Explosive", "explosive"],
            ["Radiation", "radiation"],
            ["Poison", "poison"],
        ]);
    }

    const skills = getOptionalGroup(parseResult.root, "Skills");
    if (skills) {
        sections.skills = Object.fromEntries(
            CRITTER_SKILLS.map(([displayName, dataKey]) => [dataKey, readFieldNumber(skills, displayName, "Skills")]),
        );
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
                "uint32",
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
                "uint32",
            ),
            destElevation: readClampedFieldNumber(
                stairsProperties,
                "Dest Elevation",
                "Stairs Properties",
                "pro.stairsProperties.destElevation",
                "uint32",
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
                "uint32",
            ),
            destElevation: readClampedFieldNumber(
                ladderProperties,
                "Dest Elevation",
                "Ladder Properties",
                "pro.ladderProperties.destElevation",
                "uint32",
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

    return parseWithSchemaValidation(
        proCanonicalSnapshotSchema,
        {
            schemaVersion: 1,
            format: "pro",
            formatName: parseResult.formatName,
            document: {
                header: headerData,
                sections,
            },
        },
        "Invalid PRO canonical snapshot",
    );
}

export function createProCanonicalSnapshot(parseResult: ParseResult): ProCanonicalSnapshot {
    const embeddedDocument = getProCanonicalDocument(parseResult);
    if (embeddedDocument) {
        return parseWithSchemaValidation(
            proCanonicalSnapshotSchema,
            {
                schemaVersion: 1,
                format: "pro",
                formatName: parseResult.formatName,
                document: embeddedDocument,
            },
            "Invalid PRO canonical document",
        );
    }

    return rebuildProCanonicalSnapshot(parseResult);
}

export function rebuildProCanonicalDocument(parseResult: ParseResult): ProCanonicalDocument {
    return rebuildProCanonicalSnapshot(parseResult).document;
}

export function getProCanonicalDocument(parseResult: ParseResult): ProCanonicalDocument | undefined {
    const parsed = proCanonicalDocumentSchema.safeParse(parseResult.document);
    return parsed.success ? parsed.data : undefined;
}
