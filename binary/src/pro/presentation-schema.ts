/**
 * PRO presentation schema: per-field labels, enum / flag dropdowns, pattern
 * overrides for the binary editor. Owned by the format adapter (exposed via
 * `BinaryFormatAdapter.presentationSchema` so the top-level
 * `presentation-schema.ts` does not need a parallel registry).
 */

import {
    ActionFlags,
    BodyType,
    ContainerFlags,
    CritterFlags,
    DamageType,
    ElevatorType,
    FRMType,
    HeaderFlags,
    ItemFlagsExt,
    ItemSubType,
    KillType,
    MaterialType,
    ObjectType,
    ScenerySubType,
    ScriptType as ProScriptType,
    StatType,
    WallLightFlags,
    WeaponAnimCode,
} from "./types";
import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
    stringifyKeys,
} from "../presentation-schema-types";
import type { NumericRange } from "../binary-format-contract";

export const proPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "pro",
    exactFields: {
        "pro.header.objectType": {
            label: "Object Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ObjectType),
        },
        "pro.header.frmType": { label: "FRM Type", presentationType: "enum", enumOptions: stringifyKeys(FRMType) },
        "pro.header.flags": { label: "Flags", presentationType: "flags", flagOptions: stringifyKeys(HeaderFlags) },
        "pro.itemProperties.subType": {
            label: "Sub Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ItemSubType),
        },
        "pro.sceneryProperties.subType": {
            label: "Sub Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ScenerySubType),
        },
        "pro.itemProperties.material": {
            label: "Material",
            presentationType: "enum",
            enumOptions: stringifyKeys(MaterialType),
        },
        "pro.sceneryProperties.material": {
            label: "Material",
            presentationType: "enum",
            enumOptions: stringifyKeys(MaterialType),
        },
        "pro.wallProperties.material": {
            label: "Material",
            presentationType: "enum",
            enumOptions: stringifyKeys(MaterialType),
        },
        "pro.tileProperties.material": {
            label: "Material",
            presentationType: "enum",
            enumOptions: stringifyKeys(MaterialType),
        },
        "pro.weaponStats.damageType": {
            label: "Damage Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(DamageType),
        },
        "pro.finalProperties.bodyType": {
            label: "Body Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(BodyType),
        },
        "pro.finalProperties.killType": {
            label: "Kill Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(KillType),
        },
        "pro.finalProperties.damageType": {
            label: "Damage Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(DamageType),
        },
        "pro.elevatorProperties.elevatorType": {
            label: "Elevator Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ElevatorType),
        },
        "pro.weaponStats.animationCode": {
            label: "Animation Code",
            presentationType: "enum",
            enumOptions: stringifyKeys(WeaponAnimCode),
        },
        "pro.drugStats.affectedStats.stat0": {
            label: "Stat 0",
            presentationType: "enum",
            enumOptions: stringifyKeys(StatType),
        },
        "pro.drugStats.affectedStats.stat1": {
            label: "Stat 1",
            presentationType: "enum",
            enumOptions: stringifyKeys(StatType),
        },
        "pro.drugStats.affectedStats.stat2": {
            label: "Stat 2",
            presentationType: "enum",
            enumOptions: stringifyKeys(StatType),
        },
        "pro.critterProperties.scriptType": {
            label: "Script Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ProScriptType),
        },
        "pro.itemProperties.scriptType": {
            label: "Script Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ProScriptType),
        },
        "pro.sceneryProperties.scriptType": {
            label: "Script Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ProScriptType),
        },
        "pro.wallProperties.scriptType": {
            label: "Script Type",
            presentationType: "enum",
            enumOptions: stringifyKeys(ProScriptType),
        },
        "pro.demographics.gender": {
            label: "Gender",
            presentationType: "enum",
            enumOptions: { "0": "Male", "1": "Female" },
        },
        "pro.doorProperties.walkThrough": {
            label: "Walk Through",
            presentationType: "enum",
            enumOptions: { "0": "No", "1": "Yes" },
        },
        "pro.itemProperties.flagsExt": {
            label: "Flags Ext",
            presentationType: "flags",
            flagOptions: stringifyKeys(ItemFlagsExt),
        },
        "pro.sceneryProperties.wallLightFlags": {
            label: "Wall Light Flags",
            presentationType: "flags",
            flagOptions: stringifyKeys(WallLightFlags),
        },
        "pro.sceneryProperties.actionFlags": {
            label: "Action Flags",
            presentationType: "flags",
            flagOptions: stringifyKeys(ActionFlags),
        },
        "pro.wallProperties.wallLightFlags": {
            label: "Wall Light Flags",
            presentationType: "flags",
            flagOptions: stringifyKeys(WallLightFlags),
        },
        "pro.wallProperties.actionFlags": {
            label: "Action Flags",
            presentationType: "flags",
            flagOptions: stringifyKeys(ActionFlags),
        },
        "pro.containerStats.openFlags": {
            label: "Open Flags",
            presentationType: "flags",
            flagOptions: stringifyKeys(ContainerFlags),
        },
        "pro.critterProperties.critterFlags": {
            label: "Critter Flags",
            presentationType: "flags",
            flagOptions: stringifyKeys(CritterFlags),
        },
    },
    patternFields: [],
});

export const proCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    proPresentationSchema.patternFields,
);

export const proDomainRanges: Readonly<Record<string, NumericRange>> = {
    "pro.header.lightRadius": { min: 0, max: 8 },
    "pro.header.lightIntensity": { min: 0, max: 65_536 },
    "pro.doorProperties.walkThruFlag": { min: 0, max: 1 },
    "pro.stairsProperties.destTile": { min: 0, max: 0x03_ff_ff_ff },
    "pro.stairsProperties.destElevation": { min: 0, max: 0x3f },
    "pro.ladderProperties.destTile": { min: 0, max: 0x03_ff_ff_ff },
    "pro.ladderProperties.destElevation": { min: 0, max: 0x3f },
};
