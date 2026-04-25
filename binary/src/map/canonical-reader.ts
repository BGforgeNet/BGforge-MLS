/**
 * Reader helpers for rebuilding MapCanonicalDocument/MapCanonicalSnapshot
 * from a parsed display tree (ParseResult).
 */

import { z } from "zod";
import { clampNumericValue } from "../binary-format-contract";
import { parseWithSchemaValidation } from "../schema-validation";

import { ScriptType } from "./types";
import type { ParsedField, ParsedGroup, ParseResult } from "../types";
import {
    mapCanonicalDocumentSchema,
    mapCanonicalSnapshotSchema,
    mapTileElevationSchema,
    mapScriptSlotSchema,
    mapScriptSectionSchema,
    mapObjectSchema,
    mapObjectsSchema,
    type MapCanonicalDocument,
    type MapCanonicalSnapshot,
} from "./canonical-schemas";

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

    const tiles = new Map<number, z.infer<typeof mapTileElevationSchema>["tiles"][number]>();
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
    switch ((pid >>> 24) & 0xff) {
        case 0:
            return "item";
        case 1:
            return "critter";
        case 2:
            return "scenery";
        case 3:
            return "wall";
        case 4:
            return "tile";
        case 5:
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
                object: parseMapObject(
                    entry.fields.find(
                        (field): field is ParsedGroup => isGroup(field) && /^Object \d+\.\d+ /.test(field.name),
                    )!,
                ),
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
                "int32",
            ),
            destinationRotation: readClampedNumber(
                exitGrid,
                "Destination Rotation",
                "map.objects.elevations[].objects[].exitGrid.destinationRotation",
                "int32",
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
        defaultOrientation: readClampedNumber(
            headerGroup,
            "Default Orientation",
            "map.header.defaultOrientation",
            "int32",
        ),
        numLocalVars: readNumber(headerGroup, "Num Local Vars"),
        scriptId: readNumber(headerGroup, "Script ID"),
        flags: readNumber(headerGroup, "Map Flags") >>> 0,
        darkness: readNumber(headerGroup, "Darkness"),
        numGlobalVars: readNumber(headerGroup, "Num Global Vars"),
        mapId: readNumber(headerGroup, "Map ID"),
        timestamp: readNumber(headerGroup, "Timestamp") >>> 0,
    };

    const globalVariables =
        getOptionalGroup(parseResult.root, "Global Variables")
            ?.fields.filter((entry): entry is ParsedField => !isGroup(entry))
            .map((entry) => (typeof entry.value === "number" ? entry.value : Number(entry.value))) ?? [];
    const localVariables =
        getOptionalGroup(parseResult.root, "Local Variables")
            ?.fields.filter((entry): entry is ParsedField => !isGroup(entry))
            .map((entry) => (typeof entry.value === "number" ? entry.value : Number(entry.value))) ?? [];

    const tiles = parseResult.root.fields
        .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Elevation \d+ Tiles$/.test(entry.name))
        .map((entry) => parseTileElevation(entry));

    const scripts = parseResult.root.fields
        .filter((entry): entry is ParsedGroup => isGroup(entry) && entry.name.endsWith(" Scripts"))
        .map((entry) => parseScriptSection(entry));

    const objects = parseObjects(getGroup(parseResult.root, "Objects Section"));

    return parseWithSchemaValidation(
        mapCanonicalDocumentSchema,
        {
            header,
            globalVariables,
            localVariables,
            tiles,
            scripts,
            objects,
        },
        "Invalid MAP canonical document",
    );
}

export function getMapCanonicalDocument(parseResult: ParseResult): MapCanonicalDocument | undefined {
    const parsed = mapCanonicalDocumentSchema.safeParse(parseResult.document);
    return parsed.success ? parsed.data : undefined;
}

export function createMapCanonicalSnapshot(parseResult: ParseResult): MapCanonicalSnapshot {
    const document = getMapCanonicalDocument(parseResult) ?? rebuildMapCanonicalDocument(parseResult);
    return parseWithSchemaValidation(
        mapCanonicalSnapshotSchema,
        {
            schemaVersion: 1,
            format: "map",
            formatName: parseResult.formatName,
            document,
            opaqueRanges: parseResult.opaqueRanges,
            warnings: parseResult.warnings,
            errors: parseResult.errors,
        },
        "Invalid MAP canonical snapshot",
    );
}
