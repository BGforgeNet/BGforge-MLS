/**
 * MAP file format parser for Fallout 1/2.
 * Implements BinaryParser interface for the binary editor.
 *
 * Format structure:
 * 1. Header (268 bytes + 176 unknown = 444 bytes total)
 * 2. Global variables (4 bytes each)
 * 3. Local variables (4 bytes each)
 * 4. Tiles per elevation (80,000 bytes each: 20,000 roof+floor pairs)
 * 5. Scripts (strict parsing currently uses 4 groups for RP maps)
 * 6. Objects per elevation (variable count)
 */

import type { BinaryParser, ParseOpaqueRange, ParseOptions, ParseResult, ParsedGroup, ParsedField, ParsedFieldType } from "./types";
import { rebuildMapCanonicalDocument } from "./map-canonical";
import { serializeMap } from "./map-serializer";
import { encodeOpaqueRange } from "./opaque-range";
import {
    MapVersion, MapFlags, MapElevation, ObjectFlags, Rotation, ScriptFlags, ScriptProc, ScriptType, Skill,
    hasElevation,
} from "./map-types";
import {
    HEADER_SIZE,
    TILE_DATA_SIZE_PER_ELEVATION, TILES_PER_ELEVATION,
    parseHeader, parseTilePair,
    getScriptType,
    type MapHeader,
} from "./map-schemas";

const MAP_OBJECT_BASE_SIZE = 0x48;
const MAP_OBJECT_DATA_HEADER_SIZE = 0x0C;
const STRICT_MAP_SCRIPT_TYPE_COUNT = 4;
const PID_TYPE_ITEM = 0;
const PID_TYPE_CRITTER = 1;
const PID_TYPE_SCENERY = 2;
const PID_TYPE_MISC = 5;
const FIRST_EXIT_GRID_PID = 0x5_00_00_10;
const LAST_EXIT_GRID_PID = 0x5_00_00_17;
const HEADER_PADDING_OFFSET = 0x3C;
const HEADER_PADDING_SIZE = 176;
const HEADER_OPAQUE_END = HEADER_SIZE;

function field(
    name: string,
    value: unknown,
    offset: number,
    size: number,
    type: ParsedFieldType,
    description?: string,
    rawValue?: number
): ParsedField {
    return { name, value, offset, size, type, description, rawValue };
}

function makeGroup(
    name: string,
    fields: (ParsedField | ParsedGroup)[],
    expanded = true,
    description?: string
): ParsedGroup {
    return { name, fields, expanded, description };
}

function flagsField(
    name: string,
    value: number,
    flagDefs: Record<number, string>,
    offset: number,
    size: number
): ParsedField {
    const flags: string[] = [];
    for (const [bit, flagName] of Object.entries(flagDefs)) {
        const bitVal = Number(bit);
        if (bitVal === 0) {
            if (value === 0) flags.push(flagName);
        } else if (value & bitVal) {
            flags.push(flagName);
        }
    }
    const display = flags.length > 0 ? flags.join(", ") : "(none)";
    return field(name, display, offset, size, "flags", undefined, value);
}

function enumField(
    name: string,
    value: number,
    lookup: Record<number, string>,
    offset: number,
    size: number,
    errors?: string[]
): ParsedField {
    const resolved = lookup[value];
    if (resolved === undefined && errors) {
        errors.push(`Invalid ${name} at offset 0x${offset.toString(16)}: ${value}`);
    }
    return field(name, resolved ?? `Unknown (${value})`, offset, size, "enum", undefined, value);
}

function parseHeaderSection(data: Uint8Array, errors: string[]): ParsedGroup {
    const header = parseHeader(data);

    return makeGroup("Header", [
        enumField("Version", header.version, MapVersion, 0x00, 4, errors),
        field("Filename", header.filename, 0x04, 16, "string"),
        field("Default Position", header.defaultPosition, 0x14, 4, "int32"),
        enumField("Default Elevation", header.defaultElevation, MapElevation, 0x18, 4, errors),
        enumField("Default Orientation", header.defaultOrientation, Rotation, 0x1C, 4, errors),
        field("Num Local Vars", header.numLocalVars, 0x20, 4, "int32"),
        field("Script ID", header.scriptId, 0x24, 4, "int32"),
        flagsField("Map Flags", header.flags, MapFlags, 0x28, 4),
        field("Darkness", header.darkness, 0x2C, 4, "int32"),
        field("Num Global Vars", header.numGlobalVars, 0x30, 4, "int32"),
        field("Map ID", header.mapId, 0x34, 4, "int32"),
        field("Timestamp", header.timestamp, 0x38, 4, "uint32"),
        field("Padding (field_3C)", `(${header.field_3C.length} values)`, HEADER_PADDING_OFFSET, HEADER_PADDING_SIZE, "padding"),
    ]);
}

function parseVariables(data: Uint8Array, header: MapHeader): { globalVars: number[]; localVars: number[]; offset: number } {
    let offset = HEADER_SIZE;

    const globalVars: number[] = [];
    for (let i = 0; i < header.numGlobalVars; i++) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 4);
        globalVars.push(view.getInt32(0, false));
        offset += 4;
    }

    const localVars: number[] = [];
    for (let i = 0; i < header.numLocalVars; i++) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 4);
        localVars.push(view.getInt32(0, false));
        offset += 4;
    }

    return { globalVars, localVars, offset };
}

function parseVariablesSection(data: Uint8Array, header: MapHeader): ParsedGroup[] {
    const { globalVars, localVars } = parseVariables(data, header);
    const groups: ParsedGroup[] = [];

    if (globalVars.length > 0) {
        const globalVarFields: ParsedField[] = globalVars.map((val, i) =>
            field(`Global Var ${i}`, val, HEADER_SIZE + i * 4, 4, "int32")
        );
        groups.push(makeGroup("Global Variables", globalVarFields));
    }

    if (localVars.length > 0) {
        const localOffset = HEADER_SIZE + globalVars.length * 4;
        const localVarFields: ParsedField[] = localVars.map((val, i) =>
            field(`Local Var ${i}`, val, localOffset + i * 4, 4, "int32")
        );
        groups.push(makeGroup("Local Variables", localVarFields));
    }

    return groups;
}

function parseTiles(
    data: Uint8Array,
    header: MapHeader,
    currentOffset: number,
    skipMapTiles = false,
): { tiles: Map<number, ParsedGroup[]>; offset: number; skippedRange?: ParseOpaqueRange } {
    const tiles = new Map<number, ParsedGroup[]>();
    const tileSectionStart = currentOffset;

    for (let elev = 0; elev < 3; elev++) {
        if (!hasElevation(header.flags, elev)) continue;
        if (currentOffset + TILE_DATA_SIZE_PER_ELEVATION > data.length) {
            currentOffset = data.length;
            break;
        }

        const elevTiles: ParsedGroup[] = [];
        if (skipMapTiles) {
            tiles.set(elev, elevTiles);
            currentOffset += TILE_DATA_SIZE_PER_ELEVATION;
            continue;
        }

        const tileFields: ParsedField[] = [];

        for (let i = 0; i < TILES_PER_ELEVATION; i++) {
            if (currentOffset + i * 4 + 4 > data.length) break;
            const tilePair = parseTilePair(data, currentOffset + i * 4);
            if (tilePair.floorTileId !== 0 || tilePair.roofTileId !== 0) {
                tileFields.push(
                    field(`Tile ${i} Floor`, tilePair.floorTileId, currentOffset + i * 4, 2, "uint16"),
                    field(`Tile ${i} Floor Flags`, tilePair.floorFlags, currentOffset + i * 4, 1, "uint8"),
                    field(`Tile ${i} Roof`, tilePair.roofTileId, currentOffset + i * 4 + 2, 2, "uint16"),
                    field(`Tile ${i} Roof Flags`, tilePair.roofFlags, currentOffset + i * 4 + 2, 1, "uint8")
                );
            }
        }

        if (tileFields.length > 0) {
            elevTiles.push(makeGroup(`Elevation ${elev} Tiles`, tileFields));
        }
        tiles.set(elev, elevTiles);
        currentOffset += TILE_DATA_SIZE_PER_ELEVATION;
    }

    const skippedRange = skipMapTiles
        ? encodeOpaqueRange("tiles", data, tileSectionStart, currentOffset)
        : undefined;

    return { tiles, offset: currentOffset, skippedRange };
}

function parseScriptEntryFields(
    data: Uint8Array,
    currentOffset: number,
    label: string,
    errors: string[]
): { fields: ParsedField[]; offset: number } {
    if (currentOffset + 8 > data.length) {
        errors.push(`Script entry ${label} truncated at offset 0x${currentOffset.toString(16)}`);
        return { fields: [], offset: data.length };
    }

    const fields: ParsedField[] = [];

    const sidView = new DataView(data.buffer, data.byteOffset + currentOffset, 4);
    const sid = sidView.getUint32(0, false);
    const actualScriptType = getScriptType(sid);

    fields.push(field(`${label} SID`, sid, currentOffset, 4, "uint32"));

    const field4View = new DataView(data.buffer, data.byteOffset + currentOffset + 4, 4);
    fields.push(field(`${label} Next Script Link (legacy)`, field4View.getInt32(0, false), currentOffset + 4, 4, "int32"));

    let pos = 8;
    if (actualScriptType === 1) {
        const builtTileView = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        fields.push(field(`${label} Built Tile`, builtTileView.getInt32(0, false), currentOffset + pos, 4, "int32"));
        pos += 4;
        const radiusView = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        fields.push(field(`${label} Spatial Radius`, radiusView.getInt32(0, false), currentOffset + pos, 4, "int32"));
        pos += 4;
    } else if (actualScriptType === 2) {
        const timeView = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        fields.push(field(`${label} Timer Time`, timeView.getInt32(0, false), currentOffset + pos, 4, "int32"));
        pos += 4;
    }

    const commonNames = ["Flags", "Index", "Program Pointer Slot", "Owner ID", "Local Vars Offset",
        "Num Local Vars", "Return Value", "Action", "Fixed Param", "Action Being Used",
        "Script Overrides", "Unknown Field 0x48", "Check Margin (how_much)", "Legacy Field 0x50"];
    for (const [index, name] of commonNames.entries()) {
        if (currentOffset + pos + 4 > data.length) {
            errors.push(`Script entry ${label} overflow at offset 0x${(currentOffset + pos).toString(16)}`);
            return { fields, offset: data.length };
        }

        const fview = new DataView(data.buffer, data.byteOffset + currentOffset + pos, 4);
        const value = fview.getInt32(0, false);
        if (index === 0) {
            fields.push(flagsField(`${label} ${name}`, value, ScriptFlags, currentOffset + pos, 4));
        } else if (name === "Action") {
            fields.push(enumField(`${label} ${name}`, value, ScriptProc, currentOffset + pos, 4));
        } else if (name === "Action Being Used") {
            fields.push(enumField(`${label} ${name}`, value, Skill, currentOffset + pos, 4));
        } else {
            fields.push(field(`${label} ${name}`, value, currentOffset + pos, 4, "int32"));
        }
        pos += 4;
    }

    return { fields, offset: currentOffset + pos };
}

function parseScripts(
    data: Uint8Array,
    currentOffset: number,
    errors: string[],
    scriptTypeCount: number
): { scripts: ParsedGroup[]; offset: number } {
    const scripts: ParsedGroup[] = [];

    for (let scriptType = 0; scriptType < scriptTypeCount; scriptType++) {
        if (currentOffset + 4 > data.length) break;
        if (data.length - currentOffset < 4) break;
        const countOffset = currentOffset;
        const view = new DataView(data.buffer, data.byteOffset + currentOffset, 4);
        const count = view.getInt32(0, false);
        currentOffset += 4;

        if (count < 0) {
            break;
        }

        const scriptEntries: (ParsedField | ParsedGroup)[] = [
            field("Script Count", count, countOffset, 4, "int32"),
        ];

        if (count === 0) {
            scripts.push(makeGroup(`${ScriptType[scriptType] ?? `Type${scriptType}`} Scripts`, scriptEntries));
            continue;
        }
        if (currentOffset >= data.length) {
            scripts.push(makeGroup(`${ScriptType[scriptType] ?? `Type${scriptType}`} Scripts`, scriptEntries));
            break;
        }
        const extentCount = Math.ceil(count / 16);

        for (let extentIndex = 0; extentIndex < extentCount; extentIndex++) {
            const extentFields: (ParsedField | ParsedGroup)[] = [];

            for (let slotIndex = 0; slotIndex < 16; slotIndex++) {
                const entry = parseScriptEntryFields(data, currentOffset, `Entry ${extentIndex * 16 + slotIndex}`, errors);
                if (entry.fields.length === 0) {
                    currentOffset = entry.offset;
                    break;
                }

                extentFields.push(makeGroup(`Slot ${slotIndex}`, entry.fields));
                currentOffset = entry.offset;
            }

            if (currentOffset + 8 > data.length) {
                errors.push(`Script extent ${extentIndex} metadata truncated for script type ${scriptType}`);
                break;
            }

            extentFields.push(
                int32Field("Extent Length", data, currentOffset),
                int32Field("Extent Next", data, currentOffset + 4),
            );
            currentOffset += 8;

            scriptEntries.push(makeGroup(`Extent ${extentIndex}`, extentFields));
        }

        scripts.push(makeGroup(`${ScriptType[scriptType] ?? `Type${scriptType}`} Scripts`, scriptEntries));
    }

    return { scripts, offset: currentOffset };
}

function int32Field(name: string, data: Uint8Array, offset: number): ParsedField {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return field(name, view.getInt32(0, false), offset, 4, "int32");
}

function uint32Field(name: string, data: Uint8Array, offset: number): ParsedField {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return field(name, view.getUint32(0, false), offset, 4, "uint32");
}

function noteField(name: string, value: string, offset: number): ParsedField {
    return field(name, value, offset, 0, "note");
}

function isExitGridPid(pid: number): boolean {
    return pid >= FIRST_EXIT_GRID_PID && pid <= LAST_EXIT_GRID_PID;
}

function parseObjectBaseFields(data: Uint8Array, offset: number): { fields: ParsedField[]; pid: number } {
    const pidFieldOffset = offset + 44;
    const pidView = new DataView(data.buffer, data.byteOffset + pidFieldOffset, 4);
    const pid = pidView.getInt32(0, false);

    const fields = [
        int32Field("ID", data, offset + 0),
        int32Field("Tile", data, offset + 4),
        int32Field("X", data, offset + 8),
        int32Field("Y", data, offset + 12),
        int32Field("Screen X", data, offset + 16),
        int32Field("Screen Y", data, offset + 20),
        int32Field("Frame", data, offset + 24),
        enumField("Rotation", new DataView(data.buffer, data.byteOffset + offset + 28, 4).getInt32(0, false), Rotation, offset + 28, 4),
        uint32Field("FID", data, offset + 32),
        flagsField("Flags", new DataView(data.buffer, data.byteOffset + offset + 36, 4).getInt32(0, false), ObjectFlags, offset + 36, 4),
        enumField("Elevation", new DataView(data.buffer, data.byteOffset + offset + 40, 4).getInt32(0, false), MapElevation, offset + 40, 4),
        field("PID", pid, pidFieldOffset, 4, "int32"),
        int32Field("CID", data, offset + 48),
        int32Field("Light Distance", data, offset + 52),
        int32Field("Light Intensity", data, offset + 56),
        int32Field("Field 74", data, offset + 60),
        int32Field("SID", data, offset + 64),
        int32Field("Script Index", data, offset + 68),
    ];

    return {
        fields,
        pid,
    };
}

function parseCritterDataFields(data: Uint8Array, offset: number): ParsedField[] {
    return [
        int32Field("Reaction", data, offset + 0),
        int32Field("Damage Last Turn", data, offset + 4),
        int32Field("Combat Maneuver", data, offset + 8),
        int32Field("Current AP", data, offset + 12),
        int32Field("Combat Results", data, offset + 16),
        int32Field("AI Packet", data, offset + 20),
        int32Field("Team", data, offset + 24),
        int32Field("Who Hit Me CID", data, offset + 28),
        int32Field("Current HP", data, offset + 32),
        int32Field("Radiation", data, offset + 36),
        int32Field("Poison", data, offset + 40),
    ];
}

function parseExitGridFields(data: Uint8Array, offset: number): ParsedField[] {
    return [
        int32Field("Destination Map", data, offset + 0),
        int32Field("Destination Tile", data, offset + 4),
        enumField("Destination Elevation", new DataView(data.buffer, data.byteOffset + offset + 8, 4).getInt32(0, false), MapElevation, offset + 8, 4),
        enumField("Destination Rotation", new DataView(data.buffer, data.byteOffset + offset + 12, 4).getInt32(0, false), Rotation, offset + 12, 4),
    ];
}

function objectTypeName(pid: number): string {
    switch ((pid >>> 24) & 0xFF) {
        case PID_TYPE_ITEM: return "Item";
        case PID_TYPE_CRITTER: return "Critter";
        case PID_TYPE_SCENERY: return "Scenery";
        case 3: return "Wall";
        case 4: return "Tile";
        case PID_TYPE_MISC: return "Misc";
        default: return `Type${(pid >>> 24) & 0xFF}`;
    }
}

type ParsedObjectResult = {
    complete: boolean;
    group: ParsedGroup;
    offset: number;
};

function parseObjectAt(data: Uint8Array, offset: number, index: string, header: MapHeader, errors: string[]): ParsedObjectResult {
    void header;

    if (offset + MAP_OBJECT_BASE_SIZE + MAP_OBJECT_DATA_HEADER_SIZE > data.length) {
        errors.push(`Object ${index} truncated at offset 0x${offset.toString(16)}`);
        return {
            complete: false,
            group: makeGroup(`Object ${index}`, [noteField("TODO", "Truncated object data", offset)], true),
            offset: data.length,
        };
    }

    const { fields: baseFields, pid } = parseObjectBaseFields(data, offset);
    const pidType = (pid >>> 24) & 0xFF;
    let currentOffset = offset + MAP_OBJECT_BASE_SIZE;

    const inventoryLength = int32Field("Inventory Length", data, currentOffset);
    const inventoryCapacity = int32Field("Inventory Capacity", data, currentOffset + 4);
    const inventoryPointer = int32Field("Inventory Pointer", data, currentOffset + 8);
    currentOffset += MAP_OBJECT_DATA_HEADER_SIZE;

    const objectFields: (ParsedField | ParsedGroup)[] = [
        ...baseFields,
        makeGroup("Inventory Header", [inventoryLength, inventoryCapacity, inventoryPointer]),
    ];

    if (pidType === PID_TYPE_CRITTER) {
        if (currentOffset + 44 > data.length) {
            errors.push(`Critter object ${index} payload truncated at offset 0x${currentOffset.toString(16)}`);
            objectFields.push(noteField("TODO", "Truncated critter payload", currentOffset));
            return {
                complete: false,
                group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                offset: data.length,
            };
        }

        objectFields.push(makeGroup("Critter Data", parseCritterDataFields(data, currentOffset)));
        currentOffset += 44;
    } else {
        if (currentOffset + 4 > data.length) {
            errors.push(`Object ${index} flags truncated at offset 0x${currentOffset.toString(16)}`);
            objectFields.push(noteField("TODO", "Truncated object flags", currentOffset));
            return {
                complete: false,
                group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                offset: data.length,
            };
        }

        objectFields.push(makeGroup("Object Data", [uint32Field("Data Flags", data, currentOffset)]));
        currentOffset += 4;

        if (pidType === PID_TYPE_MISC && isExitGridPid(pid)) {
            if (currentOffset + 16 > data.length) {
                errors.push(`Exit grid object ${index} payload truncated at offset 0x${currentOffset.toString(16)}`);
                objectFields.push(noteField("TODO", "Truncated exit grid payload", currentOffset));
                return {
                    complete: false,
                    group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                    offset: data.length,
                };
            }

            objectFields.push(makeGroup("Exit Grid", parseExitGridFields(data, currentOffset)));
            currentOffset += 16;
        } else if (pidType === PID_TYPE_ITEM || pidType === PID_TYPE_SCENERY) {
            objectFields.push(noteField(
                "TODO",
                "Payload decoding for item/scenery objects requires external PRO metadata to resolve subtype-specific layout",
                currentOffset
            ));
            return {
                complete: false,
                group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                offset: currentOffset,
            };
        }
    }

    const inventoryGroups: ParsedGroup[] = [];
    for (let inventoryIndex = 0; inventoryIndex < Number(inventoryLength.value); inventoryIndex++) {
        if (currentOffset + 4 > data.length) {
            errors.push(`Inventory entry ${index}.${inventoryIndex} quantity truncated at offset 0x${currentOffset.toString(16)}`);
            objectFields.push(noteField("TODO", "Truncated inventory entry", currentOffset));
            return {
                complete: false,
                group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, [...objectFields, ...inventoryGroups]),
                offset: data.length,
            };
        }

        const quantityField = int32Field("Quantity", data, currentOffset);
        currentOffset += 4;

        const nestedObject = parseObjectAt(data, currentOffset, `${index}.${inventoryIndex}`, header, errors);
        inventoryGroups.push(makeGroup(`Inventory Entry ${inventoryIndex}`, [quantityField, nestedObject.group]));
        currentOffset = nestedObject.offset;

        if (!nestedObject.complete) {
            return {
                complete: false,
                group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, [...objectFields, ...inventoryGroups]),
                offset: currentOffset,
            };
        }
    }

    return {
        complete: true,
        group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, [...objectFields, ...inventoryGroups]),
        offset: currentOffset,
    };
}

function parseObjects(
    data: Uint8Array,
    header: MapHeader,
    currentOffset: number,
    errors: string[]
): { offset: number; group: ParsedGroup; opaqueTailOffset?: number } {
    if (currentOffset >= data.length) {
        return {
            offset: currentOffset,
            group: makeGroup("Objects Section", [
                field("Total Objects", 0, currentOffset, 0, "int32"),
            ]),
        };
    }

    if (currentOffset + 4 > data.length) {
        errors.push(`Object section truncated at offset 0x${currentOffset.toString(16)}`);
        return {
            offset: data.length,
            group: makeGroup("Objects Section", [noteField("TODO", "Truncated object section header", currentOffset)]),
        };
    }

    const sectionFields: (ParsedField | ParsedGroup)[] = [];
    const totalObjects = int32Field("Total Objects", data, currentOffset);
    sectionFields.push(totalObjects);
    currentOffset += 4;

    let stoppedEarly = false;
    for (let elev = 0; elev < 3; elev++) {
        if (currentOffset + 4 > data.length) {
            errors.push(`Elevation ${elev} object count truncated at offset 0x${currentOffset.toString(16)}`);
            sectionFields.push(makeGroup(`Elevation ${elev} Objects`, [noteField("TODO", "Truncated elevation object count", currentOffset)]));
            return { offset: data.length, group: makeGroup("Objects Section", sectionFields) };
        }

        const countField = int32Field("Object Count", data, currentOffset);
        currentOffset += 4;

        const elevationFields: (ParsedField | ParsedGroup)[] = [countField];
        for (let objectIndex = 0; objectIndex < Number(countField.value); objectIndex++) {
            const parsedObject = parseObjectAt(data, currentOffset, `${elev}.${objectIndex}`, header, errors);
            elevationFields.push(parsedObject.group);
            currentOffset = parsedObject.offset;

            if (!parsedObject.complete) {
                const remainingObjects = Number(countField.value) - objectIndex - 1;
                if (remainingObjects > 0) {
                    elevationFields.push(noteField(
                        "TODO",
                        `${remainingObjects} more top-level object(s) on elevation ${elev} require a PRO resolver or a fuller object model to decode safely`,
                        currentOffset
                    ));
                }

                stoppedEarly = true;
                break;
            }
        }

        sectionFields.push(makeGroup(`Elevation ${elev} Objects`, elevationFields));
        if (stoppedEarly) {
            break;
        }
    }

    if (currentOffset < data.length) {
        const hasOnlyZeroCounts = totalObjects.value === 0
            && sectionFields
                .filter((entry): entry is ParsedGroup => "fields" in entry && /^Elevation \d+ Objects$/.test(entry.name))
                .every((entry) => fieldNumber(entry, "Object Count") === 0);

        sectionFields.push(noteField(
            "TODO",
            hasOnlyZeroCounts
                ? `Unable to confidently decode object section: script/object boundary is ambiguous near offset 0x${currentOffset.toString(16)}; preserving remaining bytes opaquely`
                : `Opaque trailing object bytes remain from offset 0x${currentOffset.toString(16)}; full decoding requires PRO-backed subtype resolution`,
            currentOffset
        ));

        return {
            offset: data.length,
            group: makeGroup("Objects Section", sectionFields),
            opaqueTailOffset: currentOffset,
        };
    }

    return { offset: data.length, group: makeGroup("Objects Section", sectionFields) };
}

function findFirstObjectGroup(group: ParsedGroup): ParsedGroup | undefined {
    for (const entry of group.fields) {
        if (!("fields" in entry)) {
            continue;
        }

        if (/^Object \d+\.\d+ /.test(entry.name)) {
            return entry;
        }

        const nested = findFirstObjectGroup(entry);
        if (nested) {
            return nested;
        }
    }

    return undefined;
}

function fieldNumber(objectGroup: ParsedGroup, name: string): number | undefined {
    const found = objectGroup.fields.find((entry) => !("fields" in entry) && entry.name === name);
    if (!found || "fields" in found) {
        return undefined;
    }

    if (typeof found.rawValue === "number") {
        return found.rawValue;
    }

    return typeof found.value === "number" ? found.value : undefined;
}

function buildOpaqueObjectsGroup(offset: number): ParsedGroup {
    return makeGroup("Objects Section", [
        field("Total Objects", 0, offset, 0, "int32"),
        makeGroup("Elevation 0 Objects", [field("Object Count", 0, offset + 4, 0, "int32")]),
        makeGroup("Elevation 1 Objects", [field("Object Count", 0, offset + 8, 0, "int32")]),
        makeGroup("Elevation 2 Objects", [field("Object Count", 0, offset + 12, 0, "int32")]),
        noteField(
            "TODO",
            `Unable to confidently decode object section: script/object boundary is ambiguous near offset 0x${offset.toString(16)}; preserving remaining bytes opaquely`,
            offset
        ),
    ]);
}

function objectCountNumbers(objectsGroup: ParsedGroup): number[] {
    return objectsGroup.fields
        .filter((entry): entry is ParsedGroup => "fields" in entry && /^Elevation \d+ Objects$/.test(entry.name))
        .map((entry) => fieldNumber(entry, "Object Count"))
        .filter((value): value is number => value !== undefined);
}

function hasTodoNote(group: ParsedGroup): boolean {
    return group.fields.some((entry) => !("fields" in entry) && entry.name === "TODO");
}

function isConfidentObjectsGroup(objectsGroup: ParsedGroup): boolean {
    const totalObjectsEntry = objectsGroup.fields.find((entry) => !("fields" in entry) && entry.name === "Total Objects");
    const totalObjects = totalObjectsEntry && !("fields" in totalObjectsEntry) && typeof totalObjectsEntry.value === "number"
        ? totalObjectsEntry.value
        : undefined;

    if (totalObjects === undefined || totalObjects < 0) {
        return false;
    }

    const objectCounts = objectCountNumbers(objectsGroup);
    if (objectCounts.length === 0 || objectCounts.some((value) => value < 0 || value > totalObjects)) {
        return false;
    }

    const parsedCountSum = objectCounts.reduce((sum, value) => sum + value, 0);
    if (parsedCountSum > totalObjects) {
        return false;
    }

    const firstObject = findFirstObjectGroup(objectsGroup);
    if (!firstObject) {
        return totalObjects === 0 && !hasTodoNote(objectsGroup);
    }

    const rotation = fieldNumber(firstObject, "Rotation");
    const elevation = fieldNumber(firstObject, "Elevation");
    const pid = fieldNumber(firstObject, "PID");

    if (rotation === undefined || rotation < 0 || rotation > 5) {
        return false;
    }

    if (elevation === undefined || elevation < 0 || elevation > 2) {
        return false;
    }

    if (pid === undefined) {
        return false;
    }

    const pidType = (pid >>> 24) & 0xFF;
    return pid === -1 || pidType <= PID_TYPE_MISC;
}

function scoreParsedTail(
    scriptTypeCount: number,
    scriptErrors: string[],
    objectsGroup: ParsedGroup
): number {
    let score = -scriptErrors.length * 100_000;
    score += (6 - scriptTypeCount) * 5;

    const totalObjectsEntry = objectsGroup.fields.find((entry) => !("fields" in entry) && entry.name === "Total Objects");
    const totalObjects = totalObjectsEntry && !("fields" in totalObjectsEntry) && typeof totalObjectsEntry.value === "number"
        ? totalObjectsEntry.value
        : undefined;

    if (totalObjects !== undefined && totalObjects >= 0) {
        score += 50;
    }

    if (totalObjects === 0) {
        score += 25;
    }

    const objectCounts = objectCountNumbers(objectsGroup);
    const parsedCountSum = objectCounts.reduce((sum, value) => sum + value, 0);

    if (objectCounts.every((value) => value >= 0)) {
        score += 30;
    } else {
        score -= 400;
    }

    if (totalObjects !== undefined) {
        if (objectCounts.some((value) => value > totalObjects)) {
            score -= 1500;
        } else {
            score += 50;
        }

        if (parsedCountSum > totalObjects) {
            score -= 1500;
        } else {
            score += 25;
        }
    }

    const firstObject = findFirstObjectGroup(objectsGroup);
    if (!firstObject) {
        if (totalObjects === 0) {
            score += 125;
        }
        return score;
    }

    if (!firstObject.name.includes("Type")) {
        score += 100;
    }

    const rotation = fieldNumber(firstObject, "Rotation");
    if (rotation !== undefined) {
        score += rotation >= 0 && rotation <= 5 ? 40 : -250;
    }

    const elevation = fieldNumber(firstObject, "Elevation");
    if (elevation !== undefined) {
        score += elevation >= 0 && elevation <= 2 ? 40 : -175;
    }

    const pid = fieldNumber(firstObject, "PID");
    if (pid !== undefined) {
        const pidType = (pid >>> 24) & 0xFF;
        score += pid === -1 || pidType <= PID_TYPE_MISC ? 40 : -175;
    }

    const sid = fieldNumber(firstObject, "SID");
    if (sid !== undefined) {
        score += sid >= -1 ? 10 : -10;
    }

    return score;
}

class MapParser implements BinaryParser {
    readonly id = "map";
    readonly name = "Fallout MAP";
    readonly extensions = ["map"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: makeGroup("MAP File", []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, options?: ParseOptions): ParseResult {
        try {
            const result = this.parseInternal(data, options);
            Object.defineProperty(result, "sourceData", {
                value: new Uint8Array(data),
                enumerable: false,
                configurable: true,
                writable: false,
            });
            return result;
        } catch (err) {
            return this.fail(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    serialize(result: ParseResult): Uint8Array {
        return serializeMap(result);
    }

    private parseInternal(data: Uint8Array, options?: ParseOptions): ParseResult {
        const errors: string[] = [];
        const opaqueRanges: ParseOpaqueRange[] = [];

        if (data.length < HEADER_SIZE) {
            return this.fail(`File too small: ${data.length} bytes, need at least ${HEADER_SIZE}`);
        }

        const header = parseHeader(data);

        if (header.version !== 19 && header.version !== 20) {
            errors.push(`Unknown MAP version: ${header.version} (expected 19 or 20)`);
        }

        const rootFields: (ParsedField | ParsedGroup)[] = [];

        rootFields.push(parseHeaderSection(data, errors));
        const filenameBytes = data.subarray(0x04, 0x14);
        const filenameTerminator = filenameBytes.indexOf(0);
        if (filenameTerminator !== -1) {
            const trailingStart = 0x04 + filenameTerminator + 1;
            const trailingBytes = data.subarray(trailingStart, 0x14);
            if (trailingBytes.some((byte) => byte !== 0)) {
                const filenameTailRange = encodeOpaqueRange(
                    "header-filename-tail",
                    data,
                    trailingStart,
                    0x14,
                );
                if (filenameTailRange) {
                    opaqueRanges.push(filenameTailRange);
                }
            }
        }
        const headerPaddingRange = encodeOpaqueRange(
            "header-padding",
            data,
            HEADER_PADDING_OFFSET,
            HEADER_OPAQUE_END,
        );
        if (headerPaddingRange) {
            opaqueRanges.push(headerPaddingRange);
        }

        const varOffset = HEADER_SIZE;
        rootFields.push(...parseVariablesSection(data, header));

        let currentOffset = varOffset + header.numGlobalVars * 4 + header.numLocalVars * 4;
        const { tiles, offset: tileEndOffset, skippedRange } = parseTiles(data, header, currentOffset, options?.skipMapTiles);
        tiles.forEach((elevTiles) => rootFields.push(...elevTiles));
        currentOffset = tileEndOffset;
        if (skippedRange) {
            opaqueRanges.push(skippedRange);
        }

        // TODO(map): Fallout 2 CE uses SCRIPT_TYPE_COUNT == 5 in
        // tmp/fallout2-ce/src/scripts.cc and tmp/fallout2-ce/src/scripts.h, but
        // real RP maps under external/fallout/Fallout2_Restoration_Project/data/maps
        // appear to place objects after 4 script lists. Strict parsing follows the
        // real RP files for now. The NMA format notes also differ in places from
        // the CE code:
        // https://nma-fallout.com/resources/fallout-2-memory-maps-and-file-formats.181/
        if (options?.gracefulMapBoundaries) {
            const scriptTailCandidates = [0, 1, 2, 3, 4, 5].map((scriptTypeCount) => {
                const candidateErrors: string[] = [];
                const { scripts, offset: scriptOffset } = parseScripts(data, currentOffset, candidateErrors, scriptTypeCount);
                const { group: objectsGroup, opaqueTailOffset } = parseObjects(data, header, scriptOffset, candidateErrors);

                return {
                    scripts,
                    scriptOffset,
                    objectsGroup,
                    opaqueTailOffset,
                    candidateErrors,
                    score: scoreParsedTail(scriptTypeCount, candidateErrors, objectsGroup),
                };
            });

            scriptTailCandidates.sort((a, b) => b.score - a.score);
            const chosenTail = scriptTailCandidates.find((candidate) => isConfidentObjectsGroup(candidate.objectsGroup))
                ?? scriptTailCandidates[0]!;

            rootFields.push(...chosenTail.scripts);
            currentOffset = chosenTail.scriptOffset;
            errors.push(...chosenTail.candidateErrors);

            const chosenTailIsConfident = isConfidentObjectsGroup(chosenTail.objectsGroup);
            const objectsGroup = chosenTailIsConfident
                ? chosenTail.objectsGroup
                : buildOpaqueObjectsGroup(chosenTail.scriptOffset);
            rootFields.push(objectsGroup);

            const opaqueRange = encodeOpaqueRange(
                "objects-tail",
                data,
                chosenTailIsConfident ? (chosenTail.opaqueTailOffset ?? data.length) : chosenTail.scriptOffset
            );
            if (opaqueRange) {
                opaqueRanges.push(opaqueRange);
            }
        } else {
            const { scripts, offset: scriptOffset } = parseScripts(data, currentOffset, errors, STRICT_MAP_SCRIPT_TYPE_COUNT);
            const { group: objectsGroup, opaqueTailOffset } = parseObjects(data, header, scriptOffset, errors);

            rootFields.push(...scripts);
            currentOffset = scriptOffset;
            rootFields.push(objectsGroup);

            const opaqueRange = encodeOpaqueRange("objects-tail", data, opaqueTailOffset ?? data.length);
            if (opaqueRange) {
                opaqueRanges.push(opaqueRange);
            }
        }

        const result: ParseResult = {
            format: this.id,
            formatName: this.name,
            root: makeGroup("MAP File", rootFields),
            opaqueRanges: opaqueRanges.length > 0 ? opaqueRanges : undefined,
            errors: errors.length > 0 ? errors : undefined,
        };

        // Lazy canonical document: rebuildMapCanonicalDocument is expensive (Zod validation,
        // O(n) field lookups per object) and the 6x gracefulMapBoundaries parse candidates
        // multiply the cost. Deferring to first access keeps parse() fast for display-only
        // consumers (editor tree, symbol outline). The document is materialized when the
        // binary editor opens a MAP for editing, or when serializing to JSON/bytes.
        //
        // Design notes:
        // - `resolved` is set true BEFORE the try block to prevent infinite recursion if
        //   rebuildMapCanonicalDocument reads result.document internally.
        // - On failure, document stays undefined permanently (no retry) — matches the
        //   original eager behavior where a failed rebuild left document as undefined.
        // - enumerable: true so JSON.stringify (used by cloneParseResult) triggers the
        //   getter and includes the property. The clone gets a plain property, not a getter.
        // - configurable: true so binaryEditor-document.ts can reassign via the setter
        //   after field edits (refreshCanonicalDocument) or reset to undefined.
        let cachedDocument: ParseResult["document"];
        let resolved = false;
        Object.defineProperty(result, "document", {
            get() {
                if (!resolved) {
                    resolved = true;
                    try {
                        cachedDocument = rebuildMapCanonicalDocument(result);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        result.warnings = [...(result.warnings ?? []), `Canonical MAP document unavailable: ${message}`];
                    }
                }
                return cachedDocument;
            },
            set(value: ParseResult["document"]) {
                cachedDocument = value;
                resolved = true;
            },
            enumerable: true,
            configurable: true,
        });
        return result;
    }
}

export const mapParser = new MapParser();
