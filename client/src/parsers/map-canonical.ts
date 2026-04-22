import { z } from "zod";
import { clampNumericValue, zodFieldNumber, zodNumericType } from "./binary-format-contract";
import { decodeOpaqueRange } from "./opaque-range";
import { opaqueRangeSchema } from "./shared-schemas";
import { parseWithSchemaValidation } from "./schema-validation";
import {
    HEADER_SIZE,
    TILES_PER_ELEVATION,
    TILE_DATA_SIZE_PER_ELEVATION,
    getScriptType,
} from "./map-schemas";
import { hasElevation, ScriptType } from "./map-types";
import type { ParseOpaqueRange, ParsedField, ParsedGroup, ParseResult } from "./types";

const MAP_OBJECT_BASE_SIZE = 0x48;
const MAP_OBJECT_DATA_HEADER_SIZE = 0x0C;
const PID_TYPE_ITEM = 0;
const PID_TYPE_CRITTER = 1;
const PID_TYPE_SCENERY = 2;
const PID_TYPE_WALL = 3;
const PID_TYPE_TILE = 4;
const PID_TYPE_MISC = 5;

const int32Schema = zodNumericType("int32");
const uint8Schema = zodNumericType("uint8");
const uint16Schema = zodNumericType("uint16");
const uint32Schema = zodNumericType("uint32");

const mapHeaderSchema = z.strictObject({
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
    index: z.number().int().min(0).max(TILES_PER_ELEVATION - 1),
    floorTileId: uint16Schema,
    floorFlags: uint8Schema,
    roofTileId: uint16Schema,
    roofFlags: uint8Schema,
});

const mapTileElevationSchema = z.strictObject({
    elevation: z.number().int().min(0).max(2),
    tiles: z.array(mapTileSchema),
});

const mapScriptSlotSchema = z.strictObject({
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

const mapScriptSectionSchema = z.strictObject({
    type: z.number().int().min(0).max(0xFF),
    count: int32Schema,
    extents: z.array(mapScriptExtentSchema),
});

const mapObjectBaseSchema = z.strictObject({
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
    destinationElevation: zodFieldNumber("map", "map.objects.elevations[].objects[].exitGrid.destinationElevation", "int32"),
    destinationRotation: zodFieldNumber("map", "map.objects.elevations[].objects[].exitGrid.destinationRotation", "int32"),
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

const mapInventoryEntrySchema: z.ZodType<{ quantity: number; object: MapCanonicalObject }> = z.lazy(() => z.strictObject({
    quantity: int32Schema,
    object: mapObjectSchema,
}));

const mapObjectSchema: z.ZodType<MapCanonicalObject> = z.lazy(() => z.strictObject({
    kind: z.enum(["item", "critter", "scenery", "wall", "tile", "misc", "unknown"]),
    base: mapObjectBaseSchema,
    inventoryHeader: mapInventoryHeaderSchema,
    objectData: mapObjectDataSchema.optional(),
    critterData: mapCritterDataSchema.optional(),
    exitGrid: mapExitGridSchema.optional(),
    inventory: z.array(mapInventoryEntrySchema),
}));

const mapObjectElevationSchema = z.strictObject({
    elevation: z.number().int().min(0).max(2),
    objectCount: int32Schema,
    objects: z.array(mapObjectSchema),
});

const mapObjectsSchema = z.strictObject({
    totalObjects: int32Schema,
    elevations: z.array(mapObjectElevationSchema).min(3).max(3),
});

const mapCanonicalDocumentSchema = z.strictObject({
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

function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return "fields" in entry;
}

function getGroup(root: ParsedGroup, name: string): ParsedGroup {
    const group = root.fields.find((entry): entry is ParsedGroup => isGroup(entry) && entry.name === name);
    if (!group) {
        throw new Error(`Missing MAP group: ${name}`);
    }
    return group;
}

function getOptionalGroup(root: ParsedGroup, name: string): ParsedGroup | undefined {
    return root.fields.find((entry): entry is ParsedGroup => isGroup(entry) && entry.name === name);
}

function getField(group: ParsedGroup, name: string): ParsedField {
    const field = group.fields.find((entry): entry is ParsedField => !isGroup(entry) && entry.name === name);
    if (!field) {
        throw new Error(`Missing MAP field: ${group.name}.${name}`);
    }
    return field;
}

function readNumber(group: ParsedGroup, name: string): number {
    const field = getField(group, name);
    if (typeof field.rawValue === "number") {
        return field.rawValue;
    }
    if (typeof field.value === "number") {
        return field.value;
    }
    throw new Error(`Field is not numeric: ${group.name}.${name}`);
}

function readClampedNumber(group: ParsedGroup, name: string, fieldKey: string, type: string): number {
    return clampNumericValue(readNumber(group, name), type, { format: "map", fieldKey });
}

function readString(group: ParsedGroup, name: string): string {
    return String(getField(group, name).value);
}

function parseTileElevation(group: ParsedGroup): z.infer<typeof mapTileElevationSchema> {
    const elevationMatch = /^Elevation (\d+) Tiles$/.exec(group.name);
    if (!elevationMatch) {
        throw new Error(`Invalid tile group: ${group.name}`);
    }

    const tiles = new Map<number, z.infer<typeof mapTileSchema>>();
    for (const entry of group.fields) {
        if (isGroup(entry)) {
            continue;
        }
        const match = /^Tile (\d+) (Floor|Floor Flags|Roof|Roof Flags)$/.exec(entry.name);
        if (!match) {
            continue;
        }

        const index = Number(match[1]);
        const tile = tiles.get(index) ?? {
            index,
            floorTileId: 0,
            floorFlags: 0,
            roofTileId: 0,
            roofFlags: 0,
        };
        const value = typeof entry.rawValue === "number" ? entry.rawValue : Number(entry.value);
        switch (match[2]) {
            case "Floor":
                tile.floorTileId = value;
                break;
            case "Floor Flags":
                tile.floorFlags = value;
                break;
            case "Roof":
                tile.roofTileId = value;
                break;
            case "Roof Flags":
                tile.roofFlags = value;
                break;
        }
        tiles.set(index, tile);
    }

    return {
        elevation: Number(elevationMatch[1]),
        tiles: [...tiles.values()].sort((a, b) => a.index - b.index),
    };
}

function parseScriptSlot(group: ParsedGroup): z.infer<typeof mapScriptSlotSchema> {
    const result: z.infer<typeof mapScriptSlotSchema> = {
        sid: 0,
        nextScriptLinkLegacy: 0,
        flags: 0,
        index: 0,
        programPointerSlot: 0,
        ownerId: 0,
        localVarsOffset: 0,
        numLocalVars: 0,
        returnValue: 0,
        action: 0,
        fixedParam: 0,
        actionBeingUsed: 0,
        scriptOverrides: 0,
        unknownField0x48: 0,
        checkMarginHowMuch: 0,
        legacyField0x50: 0,
    };

    for (const entry of group.fields) {
        if (isGroup(entry)) {
            continue;
        }
        const name = entry.name.replace(/^Entry \d+ /, "");
        const value = typeof entry.rawValue === "number" ? entry.rawValue : Number(entry.value);
        switch (name) {
            case "SID":
                result.sid = value >>> 0;
                break;
            case "Next Script Link (legacy)":
                result.nextScriptLinkLegacy = value;
                break;
            case "Built Tile":
                result.builtTile = value;
                break;
            case "Spatial Radius":
                result.spatialRadius = value;
                break;
            case "Timer Time":
                result.timerTime = value;
                break;
            case "Flags":
                result.flags = value;
                break;
            case "Index":
                result.index = value;
                break;
            case "Program Pointer Slot":
                result.programPointerSlot = value;
                break;
            case "Owner ID":
                result.ownerId = value;
                break;
            case "Local Vars Offset":
                result.localVarsOffset = value;
                break;
            case "Num Local Vars":
                result.numLocalVars = value;
                break;
            case "Return Value":
                result.returnValue = value;
                break;
            case "Action":
                result.action = value;
                break;
            case "Fixed Param":
                result.fixedParam = value;
                break;
            case "Action Being Used":
                result.actionBeingUsed = value;
                break;
            case "Script Overrides":
                result.scriptOverrides = value;
                break;
            case "Unknown Field 0x48":
                result.unknownField0x48 = value;
                break;
            case "Check Margin (how_much)":
                result.checkMarginHowMuch = value;
                break;
            case "Legacy Field 0x50":
                result.legacyField0x50 = value;
                break;
        }
    }

    return result;
}

function parseScriptSection(group: ParsedGroup): z.infer<typeof mapScriptSectionSchema> {
    const typeName = group.name.replace(/ Scripts$/, "");
    const type = Number(Object.entries(ScriptType).find(([, value]) => value === typeName)?.[0] ?? -1);
    const count = readNumber(group, "Script Count");
    const extents = group.fields
        .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Extent \d+$/.test(entry.name))
        .map((extentGroup) => ({
            slots: extentGroup.fields
                .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Slot \d+$/.test(entry.name))
                .map((slotGroup) => parseScriptSlot(slotGroup)),
            extentLength: readNumber(extentGroup, "Extent Length"),
            extentNext: readNumber(extentGroup, "Extent Next"),
        }));

    return {
        type: Math.max(type, 0),
        count,
        extents,
    };
}

function objectKindFromPid(pid: number): z.infer<typeof mapObjectSchema>["kind"] {
    switch ((pid >>> 24) & 0xFF) {
        case PID_TYPE_ITEM:
            return "item";
        case PID_TYPE_CRITTER:
            return "critter";
        case PID_TYPE_SCENERY:
            return "scenery";
        case PID_TYPE_WALL:
            return "wall";
        case PID_TYPE_TILE:
            return "tile";
        case PID_TYPE_MISC:
            return "misc";
        default:
            return "unknown";
    }
}

function parseMapObject(group: ParsedGroup): z.infer<typeof mapObjectSchema> {
    const inventoryHeader = getOptionalGroup(group, "Inventory Header");
    const objectData = getOptionalGroup(group, "Object Data");
    const critterData = getOptionalGroup(group, "Critter Data");
    const exitGrid = getOptionalGroup(group, "Exit Grid");

    const object: z.infer<typeof mapObjectSchema> = {
        kind: objectKindFromPid(readNumber(group, "PID")),
        base: {
            id: readNumber(group, "ID"),
            tile: readNumber(group, "Tile"),
            x: readNumber(group, "X"),
            y: readNumber(group, "Y"),
            screenX: readNumber(group, "Screen X"),
            screenY: readNumber(group, "Screen Y"),
            frame: readNumber(group, "Frame"),
            rotation: readNumber(group, "Rotation"),
            fid: readNumber(group, "FID"),
            flags: readNumber(group, "Flags"),
            elevation: readNumber(group, "Elevation"),
            pid: readNumber(group, "PID"),
            cid: readNumber(group, "CID"),
            lightDistance: readNumber(group, "Light Distance"),
            lightIntensity: readNumber(group, "Light Intensity"),
            field74: readNumber(group, "Field 74"),
            sid: readNumber(group, "SID"),
            scriptIndex: readNumber(group, "Script Index"),
        },
        inventoryHeader: {
            inventoryLength: inventoryHeader ? readNumber(inventoryHeader, "Inventory Length") : 0,
            inventoryCapacity: inventoryHeader ? readNumber(inventoryHeader, "Inventory Capacity") : 0,
            inventoryPointer: inventoryHeader ? readNumber(inventoryHeader, "Inventory Pointer") : 0,
        },
        inventory: group.fields
            .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Inventory Entry \d+$/.test(entry.name))
            .map((entry) => ({
                quantity: readNumber(entry, "Quantity"),
                object: parseMapObject(entry.fields.find((field): field is ParsedGroup => isGroup(field) && /^Object \d+\.\d+ /.test(field.name))!),
            })),
    };

    if (objectData) {
        object.objectData = {
            dataFlags: readNumber(objectData, "Data Flags") >>> 0,
        };
    }

    if (critterData) {
        object.critterData = {
            reaction: readNumber(critterData, "Reaction"),
            damageLastTurn: readNumber(critterData, "Damage Last Turn"),
            combatManeuver: readNumber(critterData, "Combat Maneuver"),
            currentAp: readNumber(critterData, "Current AP"),
            combatResults: readNumber(critterData, "Combat Results"),
            aiPacket: readNumber(critterData, "AI Packet"),
            team: readNumber(critterData, "Team"),
            whoHitMeCid: readNumber(critterData, "Who Hit Me CID"),
            currentHp: readNumber(critterData, "Current HP"),
            radiation: readNumber(critterData, "Radiation"),
            poison: readNumber(critterData, "Poison"),
        };
    }

    if (exitGrid) {
        object.exitGrid = {
            destinationMap: readNumber(exitGrid, "Destination Map"),
            destinationTile: readNumber(exitGrid, "Destination Tile"),
            destinationElevation: readClampedNumber(
                exitGrid,
                "Destination Elevation",
                "map.objects.elevations[].objects[].exitGrid.destinationElevation",
                "int32"
            ),
            destinationRotation: readClampedNumber(
                exitGrid,
                "Destination Rotation",
                "map.objects.elevations[].objects[].exitGrid.destinationRotation",
                "int32"
            ),
        };
    }

    return object;
}

function parseObjects(group: ParsedGroup): z.infer<typeof mapObjectsSchema> {
    const elevations = [0, 1, 2].map((elevation) => {
        const elevationGroup = getOptionalGroup(group, `Elevation ${elevation} Objects`);
        if (!elevationGroup) {
            return {
                elevation,
                objectCount: 0,
                objects: [],
            };
        }
        const objects = elevationGroup.fields
            .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Object \d+\.\d+ /.test(entry.name))
            .map((entry) => parseMapObject(entry));

        return {
            elevation,
            objectCount: readNumber(elevationGroup, "Object Count"),
            objects,
        };
    });

    return {
        totalObjects: readNumber(group, "Total Objects"),
        elevations,
    };
}

export function rebuildMapCanonicalDocument(parseResult: ParseResult): MapCanonicalDocument {
    const headerGroup = getGroup(parseResult.root, "Header");
    const header = {
        version: readNumber(headerGroup, "Version") >>> 0,
        filename: readString(headerGroup, "Filename"),
        defaultPosition: readNumber(headerGroup, "Default Position"),
        defaultElevation: readClampedNumber(headerGroup, "Default Elevation", "map.header.defaultElevation", "int32"),
        defaultOrientation: readClampedNumber(headerGroup, "Default Orientation", "map.header.defaultOrientation", "int32"),
        numLocalVars: readNumber(headerGroup, "Num Local Vars"),
        scriptId: readNumber(headerGroup, "Script ID"),
        flags: readNumber(headerGroup, "Map Flags") >>> 0,
        darkness: readNumber(headerGroup, "Darkness"),
        numGlobalVars: readNumber(headerGroup, "Num Global Vars"),
        mapId: readNumber(headerGroup, "Map ID"),
        timestamp: readNumber(headerGroup, "Timestamp") >>> 0,
    };

    const globalVariables = getOptionalGroup(parseResult.root, "Global Variables")?.fields
        .filter((entry): entry is ParsedField => !isGroup(entry))
        .map((entry) => typeof entry.value === "number" ? entry.value : Number(entry.value)) ?? [];
    const localVariables = getOptionalGroup(parseResult.root, "Local Variables")?.fields
        .filter((entry): entry is ParsedField => !isGroup(entry))
        .map((entry) => typeof entry.value === "number" ? entry.value : Number(entry.value)) ?? [];

    const tiles = parseResult.root.fields
        .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Elevation \d+ Tiles$/.test(entry.name))
        .map((entry) => parseTileElevation(entry));

    const scripts = parseResult.root.fields
        .filter((entry): entry is ParsedGroup => isGroup(entry) && entry.name.endsWith(' Scripts'))
        .map((entry) => parseScriptSection(entry));

    const objects = parseObjects(getGroup(parseResult.root, "Objects Section"));

    return parseWithSchemaValidation(mapCanonicalDocumentSchema, {
        header,
        globalVariables,
        localVariables,
        tiles,
        scripts,
        objects,
    }, "Invalid MAP canonical document");
}

export function getMapCanonicalDocument(parseResult: ParseResult): MapCanonicalDocument | undefined {
    const parsed = mapCanonicalDocumentSchema.safeParse(parseResult.document);
    return parsed.success ? parsed.data : undefined;
}

export function createMapCanonicalSnapshot(parseResult: ParseResult): MapCanonicalSnapshot {
    const document = getMapCanonicalDocument(parseResult) ?? rebuildMapCanonicalDocument(parseResult);
    return parseWithSchemaValidation(mapCanonicalSnapshotSchema, {
        schemaVersion: 1,
        format: "map",
        formatName: parseResult.formatName,
        document,
        opaqueRanges: parseResult.opaqueRanges,
        warnings: parseResult.warnings,
        errors: parseResult.errors,
    }, "Invalid MAP canonical snapshot");
}

function writeInt32(view: DataView, offset: number, value: number): void {
    view.setInt32(offset, value, false);
}

function writeUint32(view: DataView, offset: number, value: number): void {
    view.setUint32(offset, value >>> 0, false);
}

function serializeHeader(bytes: Uint8Array, header: z.infer<typeof mapHeaderSchema>): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    writeUint32(view, 0x00, header.version);
    const filenameBytes = new TextEncoder().encode(header.filename);
    for (let index = 0; index < 16; index++) {
        view.setUint8(0x04 + index, filenameBytes[index] ?? 0);
    }
    writeInt32(view, 0x14, header.defaultPosition);
    writeInt32(view, 0x18, header.defaultElevation);
    writeInt32(view, 0x1C, header.defaultOrientation);
    writeInt32(view, 0x20, header.numLocalVars);
    writeInt32(view, 0x24, header.scriptId);
    writeUint32(view, 0x28, header.flags);
    writeInt32(view, 0x2C, header.darkness);
    writeInt32(view, 0x30, header.numGlobalVars);
    writeInt32(view, 0x34, header.mapId);
    writeUint32(view, 0x38, header.timestamp);
}

function serializeVariables(view: DataView, globalVariables: number[], localVariables: number[]): number {
    let offset = HEADER_SIZE;
    for (const value of globalVariables) {
        writeInt32(view, offset, value);
        offset += 4;
    }
    for (const value of localVariables) {
        writeInt32(view, offset, value);
        offset += 4;
    }
    return offset;
}

function serializeTiles(view: DataView, header: z.infer<typeof mapHeaderSchema>, tiles: z.infer<typeof mapTileElevationSchema>[], offset: number): number {
    const tilesByElevation = new Map(tiles.map((entry) => [entry.elevation, entry]));
    for (let elevation = 0; elevation < 3; elevation++) {
        if (!hasElevation(header.flags, elevation)) {
            continue;
        }

        const tileElevation = tilesByElevation.get(elevation);
        for (const tile of tileElevation?.tiles ?? []) {
            const word = ((tile.roofFlags & 0x0F) << 28)
                | ((tile.roofTileId & 0x0FFF) << 16)
                | ((tile.floorFlags & 0x0F) << 12)
                | (tile.floorTileId & 0x0FFF);
            writeUint32(view, offset + tile.index * 4, word);
        }
        offset += TILE_DATA_SIZE_PER_ELEVATION;
    }
    return offset;
}

function serializeScriptSlot(view: DataView, slot: z.infer<typeof mapScriptSlotSchema>, offset: number): number {
    writeUint32(view, offset, slot.sid);
    writeInt32(view, offset + 4, slot.nextScriptLinkLegacy);
    let currentOffset = offset + 8;

    switch (getScriptType(slot.sid)) {
        case 1:
            writeInt32(view, currentOffset, slot.builtTile ?? 0);
            writeInt32(view, currentOffset + 4, slot.spatialRadius ?? 0);
            currentOffset += 8;
            break;
        case 2:
            writeInt32(view, currentOffset, slot.timerTime ?? 0);
            currentOffset += 4;
            break;
    }

    const commonValues = [
        slot.flags,
        slot.index,
        slot.programPointerSlot,
        slot.ownerId,
        slot.localVarsOffset,
        slot.numLocalVars,
        slot.returnValue,
        slot.action,
        slot.fixedParam,
        slot.actionBeingUsed,
        slot.scriptOverrides,
        slot.unknownField0x48,
        slot.checkMarginHowMuch,
        slot.legacyField0x50,
    ];

    for (const value of commonValues) {
        writeInt32(view, currentOffset, value);
        currentOffset += 4;
    }

    return currentOffset;
}

function serializeScripts(view: DataView, scripts: z.infer<typeof mapScriptSectionSchema>[], offset: number): number {
    for (const scriptSection of scripts) {
        writeInt32(view, offset, scriptSection.count);
        offset += 4;
        if (scriptSection.count === 0) {
            continue;
        }

        for (const extent of scriptSection.extents) {
            for (const slot of extent.slots) {
                offset = serializeScriptSlot(view, slot, offset);
            }
            writeInt32(view, offset, extent.extentLength);
            writeInt32(view, offset + 4, extent.extentNext);
            offset += 8;
        }
    }
    return offset;
}

function objectSerializedLength(object: z.infer<typeof mapObjectSchema>): number {
    let length = MAP_OBJECT_BASE_SIZE + MAP_OBJECT_DATA_HEADER_SIZE;
    const pidType = (object.base.pid >>> 24) & 0xFF;
    if (pidType === PID_TYPE_CRITTER) {
        length += 44;
    } else {
        length += 4;
        if (pidType === PID_TYPE_MISC && object.exitGrid) {
            length += 16;
        }
    }
    for (const entry of object.inventory) {
        length += 4 + objectSerializedLength(entry.object);
    }
    return length;
}

function writeObjectBase(view: DataView, base: z.infer<typeof mapObjectBaseSchema>, offset: number): void {
    writeInt32(view, offset + 0, base.id);
    writeInt32(view, offset + 4, base.tile);
    writeInt32(view, offset + 8, base.x);
    writeInt32(view, offset + 12, base.y);
    writeInt32(view, offset + 16, base.screenX);
    writeInt32(view, offset + 20, base.screenY);
    writeInt32(view, offset + 24, base.frame);
    writeInt32(view, offset + 28, base.rotation);
    writeUint32(view, offset + 32, base.fid);
    writeInt32(view, offset + 36, base.flags);
    writeInt32(view, offset + 40, base.elevation);
    writeInt32(view, offset + 44, base.pid);
    writeInt32(view, offset + 48, base.cid);
    writeInt32(view, offset + 52, base.lightDistance);
    writeInt32(view, offset + 56, base.lightIntensity);
    writeInt32(view, offset + 60, base.field74);
    writeInt32(view, offset + 64, base.sid);
    writeInt32(view, offset + 68, base.scriptIndex);
}

function serializeMapObject(view: DataView, object: z.infer<typeof mapObjectSchema>, offset: number): number {
    writeObjectBase(view, object.base, offset);
    let currentOffset = offset + MAP_OBJECT_BASE_SIZE;
    writeInt32(view, currentOffset, object.inventoryHeader.inventoryLength);
    writeInt32(view, currentOffset + 4, object.inventoryHeader.inventoryCapacity);
    writeInt32(view, currentOffset + 8, object.inventoryHeader.inventoryPointer);
    currentOffset += MAP_OBJECT_DATA_HEADER_SIZE;

    const pidType = (object.base.pid >>> 24) & 0xFF;
    if (pidType === PID_TYPE_CRITTER) {
        const critterData = object.critterData;
        if (!critterData) {
            throw new Error("critterData is required for critter MAP objects");
        }
        const values = [
            critterData.reaction,
            critterData.damageLastTurn,
            critterData.combatManeuver,
            critterData.currentAp,
            critterData.combatResults,
            critterData.aiPacket,
            critterData.team,
            critterData.whoHitMeCid,
            critterData.currentHp,
            critterData.radiation,
            critterData.poison,
        ];
        for (const value of values) {
            writeInt32(view, currentOffset, value);
            currentOffset += 4;
        }
    } else {
        writeUint32(view, currentOffset, object.objectData?.dataFlags ?? 0);
        currentOffset += 4;

        if (pidType === PID_TYPE_MISC && object.exitGrid) {
            writeInt32(view, currentOffset, object.exitGrid.destinationMap);
            writeInt32(view, currentOffset + 4, object.exitGrid.destinationTile);
            writeInt32(view, currentOffset + 8, object.exitGrid.destinationElevation);
            writeInt32(view, currentOffset + 12, object.exitGrid.destinationRotation);
            currentOffset += 16;
        }
    }

    for (const entry of object.inventory) {
        writeInt32(view, currentOffset, entry.quantity);
        currentOffset += 4;
        currentOffset = serializeMapObject(view, entry.object, currentOffset);
    }

    return currentOffset;
}

function serializeObjects(view: DataView, objects: z.infer<typeof mapObjectsSchema>, offset: number): number {
    writeInt32(view, offset, objects.totalObjects);
    offset += 4;
    for (const elevation of objects.elevations) {
        writeInt32(view, offset, elevation.objectCount);
        offset += 4;
        for (const object of elevation.objects) {
            offset = serializeMapObject(view, object, offset);
        }
    }
    return offset;
}

function objectsSerializedLength(objects: z.infer<typeof mapObjectsSchema>): number {
    let length = 4 + objects.elevations.length * 4;
    for (const elevation of objects.elevations) {
        for (const object of elevation.objects) {
            length += objectSerializedLength(object);
        }
    }
    return length;
}

function applyOpaqueRanges(target: Uint8Array, opaqueRanges?: ParseOpaqueRange[]): void {
    for (const opaqueRange of opaqueRanges ?? []) {
        target.set(decodeOpaqueRange(opaqueRange), opaqueRange.offset);
    }
}

function tileSectionLength(header: z.infer<typeof mapHeaderSchema>): number {
    let length = 0;
    for (let elevation = 0; elevation < 3; elevation++) {
        if (hasElevation(header.flags, elevation)) {
            length += TILE_DATA_SIZE_PER_ELEVATION;
        }
    }
    return length;
}

function scriptSectionLength(scripts: z.infer<typeof mapScriptSectionSchema>[]): number {
    let length = 0;
    for (const section of scripts) {
        length += 4;
        if (section.count === 0) {
            continue;
        }
        for (const extent of section.extents) {
            for (const slot of extent.slots) {
                let slotLength = 64;
                switch (getScriptType(slot.sid)) {
                    case 1:
                        slotLength += 8;
                        break;
                    case 2:
                        slotLength += 4;
                        break;
                }
                length += slotLength;
            }
            length += 8;
        }
    }
    return length;
}

export function serializeMapCanonicalDocument(document: MapCanonicalDocument, opaqueRanges?: ParseOpaqueRange[]): Uint8Array {
    const computedLength = HEADER_SIZE
        + (document.globalVariables.length + document.localVariables.length) * 4
        + tileSectionLength(document.header)
        + scriptSectionLength(document.scripts)
        + objectsSerializedLength(document.objects);
    const opaqueEnd = Math.max(0, ...(opaqueRanges ?? []).map((range) => range.offset + range.size));
    const bytes = new Uint8Array(Math.max(computedLength, opaqueEnd));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    serializeHeader(bytes, document.header);
    let offset = serializeVariables(view, document.globalVariables, document.localVariables);
    offset = serializeTiles(view, document.header, document.tiles, offset);
    offset = serializeScripts(view, document.scripts, offset);
    offset = serializeObjects(view, document.objects, offset);
    void offset;

    applyOpaqueRanges(bytes, opaqueRanges);
    return bytes;
}
