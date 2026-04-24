/**
 * Zod schemas and TypeScript types for the MAP canonical data model.
 * Shared by map-canonical-reader.ts and map-canonical-writer.ts.
 */

import { z } from "zod";
import { zodFieldNumber, zodNumericType } from "./binary-format-contract";
import { opaqueRangeSchema } from "./shared-schemas";
import { TILES_PER_ELEVATION } from "./map-schemas";

export const MAP_OBJECT_BASE_SIZE = 0x48;
export const MAP_OBJECT_DATA_HEADER_SIZE = 0x0c;
export const PID_TYPE_CRITTER = 1;
export const PID_TYPE_MISC = 5;

const int32Schema = zodNumericType("int32");
const uint8Schema = zodNumericType("uint8");
const uint16Schema = zodNumericType("uint16");
const uint32Schema = zodNumericType("uint32");

export const mapHeaderSchema = z.strictObject({
    version: uint32Schema,
    filename: z.string(),
    defaultPosition: int32Schema,
    defaultElevation: zodFieldNumber("map", "map.header.defaultElevation", "int32"),
    defaultOrientation: zodFieldNumber("map", "map.header.defaultOrientation", "int32"),
    numLocalVars: int32Schema,
    scriptId: int32Schema,
    flags: uint32Schema,
    darkness: int32Schema,
    numGlobalVars: int32Schema,
    mapId: int32Schema,
    timestamp: uint32Schema,
});

const mapTileSchema = z.strictObject({
    index: z
        .number()
        .int()
        .min(0)
        .max(TILES_PER_ELEVATION - 1),
    floorTileId: uint16Schema,
    floorFlags: uint8Schema,
    roofTileId: uint16Schema,
    roofFlags: uint8Schema,
});

export const mapTileElevationSchema = z.strictObject({
    elevation: z.number().int().min(0).max(2),
    tiles: z.array(mapTileSchema),
});

export const mapScriptSlotSchema = z.strictObject({
    sid: uint32Schema,
    nextScriptLinkLegacy: int32Schema,
    builtTile: int32Schema.optional(),
    spatialRadius: int32Schema.optional(),
    timerTime: int32Schema.optional(),
    flags: int32Schema,
    index: int32Schema,
    programPointerSlot: int32Schema,
    ownerId: int32Schema,
    localVarsOffset: int32Schema,
    numLocalVars: int32Schema,
    returnValue: int32Schema,
    action: int32Schema,
    fixedParam: int32Schema,
    actionBeingUsed: int32Schema,
    scriptOverrides: int32Schema,
    unknownField0x48: int32Schema,
    checkMarginHowMuch: int32Schema,
    legacyField0x50: int32Schema,
});

const mapScriptExtentSchema = z.strictObject({
    slots: z.array(mapScriptSlotSchema),
    extentLength: int32Schema,
    extentNext: int32Schema,
});

export const mapScriptSectionSchema = z.strictObject({
    type: z.number().int().min(0).max(0xff),
    count: int32Schema,
    extents: z.array(mapScriptExtentSchema),
});

export const mapObjectBaseSchema = z.strictObject({
    id: int32Schema,
    tile: int32Schema,
    x: int32Schema,
    y: int32Schema,
    screenX: int32Schema,
    screenY: int32Schema,
    frame: int32Schema,
    rotation: int32Schema,
    fid: uint32Schema,
    flags: int32Schema,
    elevation: int32Schema,
    pid: int32Schema,
    cid: int32Schema,
    lightDistance: int32Schema,
    lightIntensity: int32Schema,
    field74: int32Schema,
    sid: int32Schema,
    scriptIndex: int32Schema,
});

const mapInventoryHeaderSchema = z.strictObject({
    inventoryLength: int32Schema,
    inventoryCapacity: int32Schema,
    inventoryPointer: int32Schema,
});

const mapCritterDataSchema = z.strictObject({
    reaction: int32Schema,
    damageLastTurn: int32Schema,
    combatManeuver: int32Schema,
    currentAp: int32Schema,
    combatResults: int32Schema,
    aiPacket: int32Schema,
    team: int32Schema,
    whoHitMeCid: int32Schema,
    currentHp: int32Schema,
    radiation: int32Schema,
    poison: int32Schema,
});

const mapObjectDataSchema = z.strictObject({
    dataFlags: uint32Schema,
});

const mapExitGridSchema = z.strictObject({
    destinationMap: int32Schema,
    destinationTile: int32Schema,
    destinationElevation: zodFieldNumber(
        "map",
        "map.objects.elevations[].objects[].exitGrid.destinationElevation",
        "int32",
    ),
    destinationRotation: zodFieldNumber(
        "map",
        "map.objects.elevations[].objects[].exitGrid.destinationRotation",
        "int32",
    ),
});

interface MapCanonicalObject {
    kind: "item" | "critter" | "scenery" | "wall" | "tile" | "misc" | "unknown";
    base: z.infer<typeof mapObjectBaseSchema>;
    inventoryHeader: z.infer<typeof mapInventoryHeaderSchema>;
    objectData?: z.infer<typeof mapObjectDataSchema>;
    critterData?: z.infer<typeof mapCritterDataSchema>;
    exitGrid?: z.infer<typeof mapExitGridSchema>;
    inventory: Array<{ quantity: number; object: MapCanonicalObject }>;
}

const mapInventoryEntrySchema: z.ZodType<{ quantity: number; object: MapCanonicalObject }> = z.lazy(() =>
    z.strictObject({
        quantity: int32Schema,
        object: mapObjectSchema,
    }),
);

export const mapObjectSchema: z.ZodType<MapCanonicalObject> = z.lazy(() =>
    z.strictObject({
        kind: z.enum(["item", "critter", "scenery", "wall", "tile", "misc", "unknown"]),
        base: mapObjectBaseSchema,
        inventoryHeader: mapInventoryHeaderSchema,
        objectData: mapObjectDataSchema.optional(),
        critterData: mapCritterDataSchema.optional(),
        exitGrid: mapExitGridSchema.optional(),
        inventory: z.array(mapInventoryEntrySchema),
    }),
);

const mapObjectElevationSchema = z.strictObject({
    elevation: z.number().int().min(0).max(2),
    objectCount: int32Schema,
    objects: z.array(mapObjectSchema),
});

export const mapObjectsSchema = z.strictObject({
    totalObjects: int32Schema,
    elevations: z.array(mapObjectElevationSchema).min(3).max(3),
});

export const mapCanonicalDocumentSchema = z.strictObject({
    header: mapHeaderSchema,
    globalVariables: z.array(int32Schema),
    localVariables: z.array(int32Schema),
    tiles: z.array(mapTileElevationSchema),
    scripts: z.array(mapScriptSectionSchema),
    objects: mapObjectsSchema,
});

export type MapCanonicalDocument = z.infer<typeof mapCanonicalDocumentSchema>;

export const mapCanonicalSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("map"),
    formatName: z.string().min(1),
    document: mapCanonicalDocumentSchema,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export type MapCanonicalSnapshot = z.infer<typeof mapCanonicalSnapshotSchema>;
