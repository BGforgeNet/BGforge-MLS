/**
 * Reader helpers for rebuilding ProCanonicalSnapshot/ProCanonicalDocument
 * from a parsed display tree (ParseResult).
 */

import { clampNumericValue } from "../binary-format-contract";
import { resolveRawValueFromDisplay } from "../display-lookups";
import { createFieldKey, toSemanticFieldKey } from "../presentation-schema";
import { parseWithSchemaValidation } from "../schema-validation";
import {
    CRITTER_BASE_DR,
    CRITTER_BASE_DT,
    CRITTER_BASE_PRIMARY,
    CRITTER_BASE_SECONDARY,
    CRITTER_BONUS_DR,
    CRITTER_BONUS_DT,
    CRITTER_BONUS_PRIMARY,
    CRITTER_BONUS_SECONDARY,
    CRITTER_SKILLS,
} from "./types";
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

/**
 * Read every field declared in a CritterFieldDef-style table out of `group`,
 * producing a flat `dataKey -> number` map. Trailing tuple entries (offset,
 * type) are unused here — we only need the displayName/dataKey pair to drive
 * the lookup against the parsed display tree.
 */
function mapGroupFromDefs(
    group: ParsedGroup,
    defs: ReadonlyArray<readonly [displayName: string, dataKey: string, ...rest: unknown[]]>,
): Record<string, number> {
    return Object.fromEntries(
        defs.map(([displayName, dataKey]) => [dataKey, readFieldNumber(group, displayName, `${group.name}`)]),
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
            scriptType: readFieldNumber(itemProperties, "Script Type", "Item Properties"),
            scriptId: readFieldNumber(itemProperties, "Script ID", "Item Properties"),
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
        const dr = getGroup(armorStats, "Damage Resistance");
        const dt = getGroup(armorStats, "Damage Threshold");
        sections.armorStats = {
            ac: readFieldNumber(armorStats, "AC", "Armor Stats"),
            drNormal: readFieldNumber(dr, "Normal", "Armor Stats.Damage Resistance"),
            drLaser: readFieldNumber(dr, "Laser", "Armor Stats.Damage Resistance"),
            drFire: readFieldNumber(dr, "Fire", "Armor Stats.Damage Resistance"),
            drPlasma: readFieldNumber(dr, "Plasma", "Armor Stats.Damage Resistance"),
            drElectrical: readFieldNumber(dr, "Electrical", "Armor Stats.Damage Resistance"),
            drEmp: readFieldNumber(dr, "EMP", "Armor Stats.Damage Resistance"),
            drExplosion: readFieldNumber(dr, "Explosion", "Armor Stats.Damage Resistance"),
            dtNormal: readFieldNumber(dt, "Normal", "Armor Stats.Damage Threshold"),
            dtLaser: readFieldNumber(dt, "Laser", "Armor Stats.Damage Threshold"),
            dtFire: readFieldNumber(dt, "Fire", "Armor Stats.Damage Threshold"),
            dtPlasma: readFieldNumber(dt, "Plasma", "Armor Stats.Damage Threshold"),
            dtElectrical: readFieldNumber(dt, "Electrical", "Armor Stats.Damage Threshold"),
            dtEmp: readFieldNumber(dt, "EMP", "Armor Stats.Damage Threshold"),
            dtExplosion: readFieldNumber(dt, "Explosion", "Armor Stats.Damage Threshold"),
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
        const affected = getGroup(drugStats, "Affected Stats");
        const instant = getGroup(drugStats, "Instant Effect");
        const delayed1 = getGroup(drugStats, "Delayed Effect 1");
        const delayed2 = getGroup(drugStats, "Delayed Effect 2");
        const addiction = getGroup(drugStats, "Addiction");
        sections.drugStats = {
            stat0: readFieldNumber(affected, "Stat 0", "Drug Stats.Affected Stats"),
            stat1: readFieldNumber(affected, "Stat 1", "Drug Stats.Affected Stats"),
            stat2: readFieldNumber(affected, "Stat 2", "Drug Stats.Affected Stats"),
            amount0Instant: readFieldNumber(instant, "Amount 0", "Drug Stats.Instant Effect"),
            amount1Instant: readFieldNumber(instant, "Amount 1", "Drug Stats.Instant Effect"),
            amount2Instant: readFieldNumber(instant, "Amount 2", "Drug Stats.Instant Effect"),
            duration1: readFieldNumber(delayed1, "Duration", "Drug Stats.Delayed Effect 1"),
            amount0Delayed1: readFieldNumber(delayed1, "Amount 0", "Drug Stats.Delayed Effect 1"),
            amount1Delayed1: readFieldNumber(delayed1, "Amount 1", "Drug Stats.Delayed Effect 1"),
            amount2Delayed1: readFieldNumber(delayed1, "Amount 2", "Drug Stats.Delayed Effect 1"),
            duration2: readFieldNumber(delayed2, "Duration", "Drug Stats.Delayed Effect 2"),
            amount0Delayed2: readFieldNumber(delayed2, "Amount 0", "Drug Stats.Delayed Effect 2"),
            amount1Delayed2: readFieldNumber(delayed2, "Amount 1", "Drug Stats.Delayed Effect 2"),
            amount2Delayed2: readFieldNumber(delayed2, "Amount 2", "Drug Stats.Delayed Effect 2"),
            addictionRate: readFieldNumber(addiction, "Rate", "Drug Stats.Addiction"),
            addictionEffect: readFieldNumber(addiction, "Effect", "Drug Stats.Addiction"),
            addictionOnset: readFieldNumber(addiction, "Onset", "Drug Stats.Addiction"),
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
        const basePrimary = getGroup(parseResult.root, "Base Primary Stats");
        const baseSecondary = getGroup(parseResult.root, "Base Secondary Stats");
        const baseDt = getGroup(parseResult.root, "Base Damage Threshold");
        const baseDr = getGroup(parseResult.root, "Base Damage Resistance");
        const demographics = getGroup(parseResult.root, "Demographics");
        const bonusPrimary = getGroup(parseResult.root, "Bonus Primary Stats");
        const bonusSecondary = getGroup(parseResult.root, "Bonus Secondary Stats");
        const bonusDt = getGroup(parseResult.root, "Bonus Damage Threshold");
        const bonusDr = getGroup(parseResult.root, "Bonus Damage Resistance");
        const skills = getGroup(parseResult.root, "Skills");
        const finalProperties = getGroup(parseResult.root, "Final Properties");

        sections.critterStats = {
            flagsExt: readFieldNumber(critterProperties, "Flags Ext", "Critter Properties"),
            scriptType: readFieldNumber(critterProperties, "Script Type", "Critter Properties"),
            scriptId: readFieldNumber(critterProperties, "Script ID", "Critter Properties"),
            headFrmId: readFieldNumber(critterProperties, "Head FRM ID", "Critter Properties"),
            aiPacket: readFieldNumber(critterProperties, "AI Packet", "Critter Properties"),
            teamNumber: readFieldNumber(critterProperties, "Team Number", "Critter Properties"),
            critterFlags: readFieldNumber(critterProperties, "Critter Flags", "Critter Properties"),
            ...mapGroupFromDefs(basePrimary, CRITTER_BASE_PRIMARY),
            ...mapGroupFromDefs(baseSecondary, CRITTER_BASE_SECONDARY),
            ...mapGroupFromDefs(baseDt, CRITTER_BASE_DT),
            ...mapGroupFromDefs(baseDr, CRITTER_BASE_DR),
            age: readFieldNumber(demographics, "Age", "Demographics"),
            gender: readFieldNumber(demographics, "Gender", "Demographics"),
            ...mapGroupFromDefs(bonusPrimary, CRITTER_BONUS_PRIMARY),
            ...mapGroupFromDefs(bonusSecondary, CRITTER_BONUS_SECONDARY),
            ...mapGroupFromDefs(bonusDt, CRITTER_BONUS_DT),
            ...mapGroupFromDefs(bonusDr, CRITTER_BONUS_DR),
            // No "Bonus Demographics" group exists in the display tree; the wire
            // bytes for ageBonus/genderBonus are always written as 0 by the engine.
            ageBonus: 0,
            genderBonus: 0,
            ...mapGroupFromDefs(skills, CRITTER_SKILLS),
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
            scriptType: readFieldNumber(sceneryProperties, "Script Type", "Scenery Properties"),
            scriptId: readFieldNumber(sceneryProperties, "Script ID", "Scenery Properties"),
            subType: readFieldNumber(sceneryProperties, "Sub Type", "Scenery Properties"),
            materialId: readFieldNumber(sceneryProperties, "Material", "Scenery Properties"),
            soundId: readFieldNumber(sceneryProperties, "Sound ID", "Scenery Properties"),
        };
    }

    const doorProperties = getOptionalGroup(parseResult.root, "Door Properties");
    if (doorProperties) {
        sections.doorProperties = {
            walkThruFlag: readClampedFieldNumber(
                doorProperties,
                "Walk Through",
                "Door Properties",
                "pro.doorProperties.walkThruFlag",
                "uint32",
            ),
            unknown: readFieldNumber(doorProperties, "Unknown", "Door Properties"),
        };
    }

    const stairsProperties = getOptionalGroup(parseResult.root, "Stairs Properties");
    if (stairsProperties) {
        sections.stairsProperties = {
            destTile: readFieldNumber(stairsProperties, "Dest Tile", "Stairs Properties"),
            destElevation: readFieldNumber(stairsProperties, "Dest Elevation", "Stairs Properties"),
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
            destTile: readFieldNumber(ladderProperties, "Dest Tile", "Ladder Properties"),
            destElevation: readFieldNumber(ladderProperties, "Dest Elevation", "Ladder Properties"),
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
            scriptType: readFieldNumber(wallProperties, "Script Type", "Wall Properties"),
            scriptId: readFieldNumber(wallProperties, "Script ID", "Wall Properties"),
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
