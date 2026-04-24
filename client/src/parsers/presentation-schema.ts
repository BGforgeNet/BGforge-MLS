import { z } from "zod";
import {
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
    ActionFlags,
    WeaponAnimCode,
} from "./pro-types";
import { MapElevation, MapFlags, ObjectFlags, Rotation, ScriptProc, ScriptFlags, Skill } from "./map-types";
import { formatAdapterRegistry } from "./format-adapter";

const numericFormatSchema = z.enum(["decimal", "hex32"]);
const flagActivationSchema = z.enum(["set", "clear", "equal"]);

const presentationOptionsSchema = z.record(z.string(), z.string());

const fieldPresentationSchema = z.strictObject({
    label: z.string().min(1).optional(),
    presentationType: z.enum(["scalar", "enum", "flags"]).optional(),
    enumOptions: presentationOptionsSchema.optional(),
    flagOptions: presentationOptionsSchema.optional(),
    flagActivation: z.record(z.string(), flagActivationSchema).optional(),
    numericFormat: numericFormatSchema.optional(),
    editable: z.boolean().optional(),
});

const patternFieldPresentationSchema = fieldPresentationSchema.extend({
    pathPattern: z.string().min(1),
    fieldNamePattern: z.string().min(1).optional(),
});

const formatPresentationSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.string().min(1),
    exactFields: z.record(z.string(), fieldPresentationSchema),
    patternFields: z.array(patternFieldPresentationSchema),
});

type FieldPresentation = z.infer<typeof fieldPresentationSchema>;
type PatternFieldPresentation = z.infer<typeof patternFieldPresentationSchema>;
type FormatPresentationSchema = z.infer<typeof formatPresentationSchema>;

export function createFieldKey(segments: readonly string[]): string {
    return `/${segments.map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

export function toSemanticFieldKey(format: string, segments: readonly string[]): string | undefined {
    const adapter = formatAdapterRegistry.get(format);
    if (adapter) {
        return adapter.toSemanticFieldKey(segments);
    }
    return undefined;
}

export function createSemanticFieldKeyFromId(format: string, fieldId: string): string | undefined {
    try {
        const segments = JSON.parse(fieldId) as unknown;
        if (!Array.isArray(segments) || !segments.every((segment) => typeof segment === "string")) {
            return undefined;
        }
        return toSemanticFieldKey(format, segments);
    } catch {
        return undefined;
    }
}

function stringifyKeys(table: Record<number, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(table).map(([key, value]) => [String(key), value]));
}

const scriptProcDropdown = Object.fromEntries(
    Object.entries(ScriptProc)
        .filter(([, value]) => value !== "none_x_bad")
        .map(([key, value]) => [String(key), value]),
) as Record<string, string>;

const proPresentationSchema = formatPresentationSchema.parse({
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

const mapPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "map",
    exactFields: {
        "map.header.version": { label: "Version", editable: false },
        "map.header.defaultElevation": {
            label: "Default Elevation",
            presentationType: "enum",
            enumOptions: stringifyKeys(MapElevation),
        },
        "map.header.defaultOrientation": {
            label: "Default Orientation",
            presentationType: "enum",
            enumOptions: stringifyKeys(Rotation),
        },
        "map.header.numLocalVars": { label: "Num Local Vars", editable: false },
        "map.header.numGlobalVars": { label: "Num Global Vars", editable: false },
        "map.objects.totalObjects": { label: "Total Objects", editable: false },
        "map.header.mapFlags": {
            label: "Map Flags",
            presentationType: "flags",
            flagOptions: {
                "1": MapFlags[0x1]!,
                "2": "Has Elevation 0",
                "4": "Has Elevation 1",
                "8": "Has Elevation 2",
            },
            flagActivation: { "1": "set", "2": "clear", "4": "clear", "8": "clear" },
            editable: false,
        },
        "map.header.filename": { label: "Filename" },
    },
    patternFields: [
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.(pid|fid|cid|sid)$",
            numericFormat: "hex32",
        },
        { pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.sid$", numericFormat: "hex32" },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.rotation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(Rotation),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.elevation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(MapElevation),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.exitGrid\\.destinationElevation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(MapElevation),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.exitGrid\\.destinationRotation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(Rotation),
        },
        {
            pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.action$",
            presentationType: "enum",
            enumOptions: scriptProcDropdown,
        },
        {
            pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.actionBeingUsed$",
            presentationType: "enum",
            enumOptions: stringifyKeys(Skill),
        },
        {
            pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.flags$",
            presentationType: "flags",
            flagOptions: stringifyKeys(ScriptFlags),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.flags$",
            presentationType: "flags",
            flagOptions: stringifyKeys(ObjectFlags),
        },
        { pathPattern: "^map\\.header\\.(version|numLocalVars|numGlobalVars|mapFlags)$", editable: false },
        { pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.(extentLength|extentNext)$", editable: false },
        {
            pathPattern:
                "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.(localVarsOffset|numLocalVars|programPointerSlot|unknownField0x48|legacyField0x50)$",
            editable: false,
        },
        { pathPattern: "^map\\.objects\\.(totalObjects|elevations\\[\\]\\.objectCount)$", editable: false },
        {
            pathPattern:
                "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.(base\\.field74|inventoryHeader\\.(inventoryLength|inventoryCapacity|inventoryPointer))$",
            editable: false,
        },
    ],
});

const binaryPresentationSchemas = {
    pro: proPresentationSchema,
    map: mapPresentationSchema,
} as const satisfies Record<string, FormatPresentationSchema>;

type SupportedPresentationFormat = keyof typeof binaryPresentationSchemas;

interface CompiledPatternFieldPresentation extends PatternFieldPresentation {
    readonly pathRegex: RegExp;
    readonly fieldNameRegex?: RegExp;
}

const compiledPatternSchemas: Record<SupportedPresentationFormat, readonly CompiledPatternFieldPresentation[]> = {
    pro: proPresentationSchema.patternFields.map((entry) => ({
        ...entry,
        pathRegex: new RegExp(entry.pathPattern),
        fieldNameRegex: entry.fieldNamePattern ? new RegExp(entry.fieldNamePattern) : undefined,
    })),
    map: mapPresentationSchema.patternFields.map((entry) => ({
        ...entry,
        pathRegex: new RegExp(entry.pathPattern),
        fieldNameRegex: entry.fieldNamePattern ? new RegExp(entry.fieldNamePattern) : undefined,
    })),
};

function mergePresentation(base: FieldPresentation, override: FieldPresentation): FieldPresentation {
    return {
        ...base,
        ...override,
        enumOptions: override.enumOptions ?? base.enumOptions,
        flagOptions: override.flagOptions ?? base.flagOptions,
        flagActivation: override.flagActivation ?? base.flagActivation,
    };
}

function toFieldPresentation(entry: PatternFieldPresentation | CompiledPatternFieldPresentation): FieldPresentation {
    return {
        label: entry.label,
        presentationType: entry.presentationType,
        enumOptions: entry.enumOptions,
        flagOptions: entry.flagOptions,
        flagActivation: entry.flagActivation,
        numericFormat: entry.numericFormat,
        editable: entry.editable,
    };
}

export function getFormatPresentationSchema(format: string): FormatPresentationSchema | undefined {
    return binaryPresentationSchemas[format as SupportedPresentationFormat];
}

export function resolveFieldPresentation(
    format: string,
    fieldKey: string,
    fieldName: string,
): FieldPresentation | undefined {
    const schema = getFormatPresentationSchema(format);
    if (!schema) {
        return undefined;
    }

    let presentation: FieldPresentation = {};
    const patterns = compiledPatternSchemas[format as SupportedPresentationFormat];
    if (patterns) {
        for (const entry of patterns) {
            if (!entry.pathRegex.test(fieldKey)) {
                continue;
            }
            if (entry.fieldNameRegex && !entry.fieldNameRegex.test(fieldName)) {
                continue;
            }
            presentation = mergePresentation(presentation, toFieldPresentation(entry));
        }
    }

    const exact = schema.exactFields[fieldKey];
    if (exact) {
        presentation = mergePresentation(presentation, exact);
    }

    return Object.keys(presentation).length > 0 ? presentation : undefined;
}

export function toNumericOptionMap(options?: Record<string, string>): Record<number, string> | undefined {
    if (!options) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(options).map(([key, value]) => [Number(key), value]));
}
