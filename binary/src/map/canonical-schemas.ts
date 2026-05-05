/**
 * Zod schemas and TypeScript types for the MAP canonical data model.
 * Shared by map-canonical-reader.ts and map-canonical-writer.ts.
 */

import { z } from "zod";
import { zodFieldNumber, zodNumericType } from "../binary-format-contract";
import { opaqueRangeSchema } from "../shared-schemas";
import { TILES_PER_ELEVATION } from "./schemas";
import { toZodSchema } from "../spec/derive-zod";
import { critterDataSpec, inventoryHeaderSpec } from "./specs/object";

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

// Hand-written rather than derived from objectBaseSpec because real-world
// MAP files carry non-enum values in `rotation` and `elevation` for object
// records (packed PID-like values around 0x02000020 leak into these slots
// in widely-used mods). The spec's enum tables describe the documented
// format; the canonical zod stays permissive at int32 to accept what
// actually ships.
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

// Derived from inventoryHeaderSpec / critterDataSpec — both are plain
// int32 fields with no enum or flags refinement, so the spec system's
// derived zod produces an identical strictObject without duplicating
// the field list.
const mapInventoryHeaderSchema = toZodSchema(inventoryHeaderSpec);
const mapCritterDataSchema = toZodSchema(critterDataSpec);

const mapObjectDataSchema = z.strictObject({
    dataFlags: uint32Schema,
});

// Hand-written rather than derived from exitGridSpec for the same reason
// as mapObjectBaseSchema above: shipped MAP files put non-enum values in
// these slots and the canonical doc stays permissive at int32. The
// canonical reader applies clampNumericValue to keep values inside int32
// range when surfacing them to the canonical doc.
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

// Stores the trailing per-subtype payload of an item/scenery record. `values`
// holds the raw int32 fields in wire order (length 0/1/2 depending on subType
// + map version); the writer emits exactly those bytes. `subType` is recorded
// so a snapshot reparse can rebuild a pid → subType resolver from the
// document itself, without consulting the original filesystem-backed
// resolver — the canonical doc is otherwise self-describing for round-trip.
const mapSubtypeDataSchema = z.strictObject({
    subType: int32Schema,
    values: z.array(int32Schema),
});

interface MapCanonicalObject {
    kind: "item" | "critter" | "scenery" | "wall" | "tile" | "misc" | "unknown";
    base: z.infer<typeof mapObjectBaseSchema>;
    inventoryHeader: z.infer<typeof mapInventoryHeaderSchema>;
    objectData?: z.infer<typeof mapObjectDataSchema>;
    critterData?: z.infer<typeof mapCritterDataSchema>;
    exitGrid?: z.infer<typeof mapExitGridSchema>;
    subtypeData?: z.infer<typeof mapSubtypeDataSchema>;
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
        subtypeData: mapSubtypeDataSchema.optional(),
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
