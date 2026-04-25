/**
 * Writer helpers for serializing ProCanonicalSnapshot/ProCanonicalDocument
 * back to binary PRO format bytes.
 */

import { BufferWriter } from "typed-binary";
import { parseWithSchemaValidation } from "../schema-validation";
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
} from "./schemas";
import {
    CRITTER_SIZE,
    HEADER_SIZE,
    ITEM_SUBTYPE_OFFSET,
    ITEM_SUBTYPE_SIZES,
    MISC_SIZE,
    SCENERY_SUBTYPE_OFFSET,
    SCENERY_SUBTYPE_SIZES,
    TILE_SIZE,
    WALL_SIZE,
} from "./types";
import { proCanonicalSnapshotSchema, type ProCanonicalSnapshot, type ProCanonicalDocument } from "./canonical-schemas";

function writer(data: Uint8Array, offset = 0): BufferWriter {
    return new BufferWriter(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

function packScriptId(script: { type: number; id: number }): number {
    if (script.type === -1 && script.id === -1) {
        return 0xff_ff_ff_ff;
    }
    return ((script.type & 0xff) << 24) | (script.id & 0x00_ff_ff_ff);
}

function packDestTileAndElevation(destTile: number, destElevation: number): number {
    return ((destElevation & 0x3f) << 26) | (destTile & 0x03_ff_ff_ff);
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
        objectTypeAndId: ((header.objectType & 0xff) << 24) | (header.objectId & 0x00_ff_ff_ff),
        textId: header.textId,
        frmTypeAndId: ((header.frmType & 0xff) << 24) | (header.frmId & 0x00_ff_ff_ff),
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
                        destTileAndElevation: packDestTileAndElevation(
                            sections.stairsProperties!.destTile,
                            sections.stairsProperties!.destElevation,
                        ),
                        destMap: sections.stairsProperties!.destMap,
                    });
                    break;
                case 2:
                    elevatorSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), sections.elevatorProperties!);
                    break;
                case 3:
                case 4:
                    ladderSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), {
                        destTileAndElevation: packDestTileAndElevation(
                            sections.ladderProperties!.destTile,
                            sections.ladderProperties!.destElevation,
                        ),
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

export function serializeProCanonicalDocument(
    document: ProCanonicalDocument,
    formatName = "Fallout PRO (Prototype)",
): Uint8Array {
    return serializeProCanonicalSnapshot(
        parseWithSchemaValidation(
            proCanonicalSnapshotSchema,
            {
                schemaVersion: 1,
                format: "pro",
                formatName,
                document,
            },
            "Invalid PRO canonical document",
        ),
    );
}
