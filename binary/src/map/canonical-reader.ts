/**
 * Reader helpers for rebuilding MapCanonicalDocument/MapCanonicalSnapshot
 * from a parsed display tree (ParseResult).
 */

import { z } from "zod";
import { clampNumericValue } from "../binary-format-contract";
import { parseWithSchemaValidation } from "../schema-validation";
import { walkGroup } from "../spec/walk-display";

import { ScriptType } from "./types";
import { getScriptType } from "./schemas";
import type { ParsedField, ParsedGroup, ParseResult } from "../types";
import { mapHeaderCanonicalSpec, mapHeaderPresentation } from "./specs/header";
import {
    objectBaseSpec,
    objectBasePresentation,
    inventoryHeaderSpec,
    inventoryHeaderPresentation,
    critterDataSpec,
    critterPresentation,
    exitGridSpec,
    exitGridPresentation,
} from "./specs/object";
import {
    otherSlotSpec,
    otherSlotPresentation,
    spatialSlotSpec,
    spatialSlotPresentation,
    timerSlotSpec,
    timerSlotPresentation,
} from "./specs/script-slot";
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

// Slot fields are wrapped in `${label} ${fieldName}` by the display tree
// so the surrounding "Slot N" group can host an outer label. walkGroup
// looks up by exact name, so strip the prefix before walking.
function stripFieldPrefix(group: ParsedGroup, prefixPattern: RegExp): ParsedGroup {
    return {
        ...group,
        fields: group.fields.map((entry) =>
            isGroup(entry) ? entry : { ...entry, name: entry.name.replace(prefixPattern, "") },
        ),
    };
}

function parseScriptSlot(group: ParsedGroup): z.infer<typeof mapScriptSlotSchema> {
    const cleaned = stripFieldPrefix(group, /^Entry \d+ /);
    const sidField = cleaned.fields.find((entry): entry is ParsedField => !isGroup(entry) && entry.name === "SID");
    if (!sidField) {
        throw new Error(`Missing MAP field: ${group.name}.SID`);
    }
    const sidRaw = typeof sidField.rawValue === "number" ? sidField.rawValue : Number(sidField.value);
    const scriptType = getScriptType(sidRaw >>> 0);

    if (scriptType === 1) {
        const slot = walkGroup(cleaned, spatialSlotSpec, spatialSlotPresentation);
        return { ...slot, sid: slot.sid >>> 0 };
    }
    if (scriptType === 2) {
        const slot = walkGroup(cleaned, timerSlotSpec, timerSlotPresentation);
        return { ...slot, sid: slot.sid >>> 0 };
    }
    const slot = walkGroup(cleaned, otherSlotSpec, otherSlotPresentation);
    return { ...slot, sid: slot.sid >>> 0 };
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
    const subtypeData = getOptionalGroup(group, "Subtype Data");

    const base = walkGroup(group, objectBaseSpec, objectBasePresentation);
    const object: z.infer<typeof mapObjectSchema> = {
        kind: objectKindFromPid(base.pid),
        base: { ...base, fid: base.fid >>> 0 },
        inventoryHeader: inventoryHeader
            ? walkGroup(inventoryHeader, inventoryHeaderSpec, inventoryHeaderPresentation)
            : { inventoryLength: 0, inventoryCapacity: 0, inventoryPointer: 0 },
        inventory: group.fields
            .filter((entry): entry is ParsedGroup => isGroup(entry) && /^Inventory Entry \d+$/.test(entry.name))
            .map((entry) => ({
                quantity: readNumber(entry, "Quantity"),
                object: parseMapObject(
                    // Inventory recursion creates names like "Object 0.0.0 (Item)" /
                    // "Object 0.0.0.0 (Item)" — match any dotted index path, not
                    // just the two-level "elevation.index" form used at top level.
                    entry.fields.find(
                        (field): field is ParsedGroup => isGroup(field) && /^Object [\d.]+ /.test(field.name),
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
        object.critterData = walkGroup(critterData, critterDataSpec, critterPresentation);
    }

    if (subtypeData) {
        // Field shapes are decoded by parse-objects.ts:decodeItemSubtypeTrailer /
        // decodeScenerySubtypeTrailer in wire order. The first child is a
        // synthetic 0-byte "Sub Type" note carrying the resolved subType so
        // the canonical doc can rebuild a resolver during snapshot reparse;
        // the remaining children are the actual int32 trailer values.
        const fields = subtypeData.fields.filter((entry): entry is import("../types").ParsedField => !isGroup(entry));
        const subTypeField = fields.find((f) => f.name === "Sub Type");
        const valueFields = fields.filter((f) => f.name !== "Sub Type");
        object.subtypeData = {
            subType: typeof subTypeField?.rawValue === "number" ? subTypeField.rawValue : -1,
            values: valueFields.map((entry) => (typeof entry.value === "number" ? entry.value : 0)),
        };
    }

    if (exitGrid) {
        const grid = walkGroup(exitGrid, exitGridSpec, exitGridPresentation);
        object.exitGrid = {
            destinationMap: grid.destinationMap,
            destinationTile: grid.destinationTile,
            destinationElevation: clampNumericValue(grid.destinationElevation, "int32", {
                format: "map",
                fieldKey: "map.objects.elevations[].objects[].exitGrid.destinationElevation",
            }),
            destinationRotation: clampNumericValue(grid.destinationRotation, "int32", {
                format: "map",
                fieldKey: "map.objects.elevations[].objects[].exitGrid.destinationRotation",
            }),
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
    const headerScalars = walkGroup(headerGroup, mapHeaderCanonicalSpec, mapHeaderPresentation);
    const header = {
        ...headerScalars,
        version: headerScalars.version >>> 0,
        filename: readString(headerGroup, "Filename"),
        flags: headerScalars.flags >>> 0,
        timestamp: headerScalars.timestamp >>> 0,
        defaultElevation: clampNumericValue(headerScalars.defaultElevation, "int32", {
            format: "map",
            fieldKey: "map.header.defaultElevation",
        }),
        defaultOrientation: clampNumericValue(headerScalars.defaultOrientation, "int32", {
            format: "map",
            fieldKey: "map.header.defaultOrientation",
        }),
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
