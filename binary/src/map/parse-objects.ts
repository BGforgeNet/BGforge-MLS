/**
 * Parse functions for MAP object data (base fields, critter data, exit grids, inventory).
 */

import { BufferReader } from "typed-binary";
import type { ParsedField, ParsedGroup } from "../types";
import type { MapHeader } from "./schemas";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { walkStruct } from "../spec/walk-display";
import { resolvePidSubType, type PidResolver } from "../pid-resolver";
import {
    makeGroup,
    int32Field,
    uint32Field,
    noteField,
    isExitGridPid,
    objectTypeName,
    fieldNumber,
    MAP_OBJECT_BASE_SIZE,
    MAP_OBJECT_DATA_HEADER_SIZE,
    PID_TYPE_CRITTER,
    PID_TYPE_MISC,
    PID_TYPE_ITEM,
    PID_TYPE_SCENERY,
} from "./parse-helpers";
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

export interface ParseObjectsOptions {
    pidResolver?: PidResolver;
}

const objectBaseCodec = toTypedBinarySchema(objectBaseSpec);
const inventoryHeaderCodec = toTypedBinarySchema(inventoryHeaderSpec);
const critterDataCodec = toTypedBinarySchema(critterDataSpec);
const exitGridCodec = toTypedBinarySchema(exitGridSpec);

function readSpec<T>(
    codec: { read(input: import("typed-binary").ISerialInput): T },
    data: Uint8Array,
    offset: number,
): T {
    const reader = new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
    return codec.read(reader);
}

type ParsedObjectResult = {
    complete: boolean;
    group: ParsedGroup;
    offset: number;
};

// Minimum bytes a single inventory entry consumes on the wire: a 4-byte
// quantity prefix plus the nested object's base record + data header.
const MIN_INVENTORY_ENTRY_BYTES = 4 + MAP_OBJECT_BASE_SIZE + MAP_OBJECT_DATA_HEADER_SIZE;

// Minimum bytes a single top-level elevation object consumes on the wire.
const MIN_OBJECT_BYTES = MAP_OBJECT_BASE_SIZE + MAP_OBJECT_DATA_HEADER_SIZE;

/**
 * Clamp a count read from the wire against what the remaining buffer could
 * physically hold (one item of `minItemBytes` per slot). A malformed file
 * with a 2^30+ count would otherwise iterate billions of times before the
 * per-iteration buffer check terminated the loop. Negative counts are a
 * benign legacy sentinel for "empty elevation" / "no inventory" in
 * real-world MAP files (e.g., Fallout 2 RP's `sfchina2.map` carries
 * `objectCount = -1` for unused elevations) — quietly treat as 0; the old
 * `for (i = 0; i < count; i++)` loop did the same. Surface an error only
 * for the positive-overflow case where a count exceeds what the remaining
 * buffer can hold.
 */
function clampObjectCount(
    rawCount: number,
    label: string,
    remainingBytes: number,
    minItemBytes: number,
    errors: string[],
): number {
    if (rawCount <= 0) return 0;
    const maxCount = Math.max(0, Math.floor(remainingBytes / minItemBytes));
    if (rawCount > maxCount) {
        errors.push(
            `Map reports ${rawCount} ${label} but only ${maxCount} fit in the remaining buffer; treating as malformed`,
        );
        return 0;
    }
    return rawCount;
}

function parseObjectBaseFields(
    data: Uint8Array,
    offset: number,
): { fields: (ParsedField | ParsedGroup)[]; pid: number } {
    const obj = readSpec(objectBaseCodec, data, offset);
    const group = walkStruct(objectBaseSpec, objectBasePresentation, offset, obj, "Object Base");
    return { fields: group.fields, pid: obj.pid };
}

function parseCritterDataGroup(data: Uint8Array, offset: number): ParsedGroup {
    const c = readSpec(critterDataCodec, data, offset);
    return walkStruct(critterDataSpec, critterPresentation, offset, c, "Critter Data");
}

function parseExitGridGroup(data: Uint8Array, offset: number): ParsedGroup {
    const e = readSpec(exitGridCodec, data, offset);
    return walkStruct(exitGridSpec, exitGridPresentation, offset, e, "Exit Grid");
}

function parseInventoryHeaderGroup(data: Uint8Array, offset: number): { group: ParsedGroup; inventoryLength: number } {
    const inv = readSpec(inventoryHeaderCodec, data, offset);
    return {
        group: walkStruct(inventoryHeaderSpec, inventoryHeaderPresentation, offset, inv, "Inventory Header"),
        inventoryLength: inv.inventoryLength,
    };
}

/**
 * Decode the per-subtype trailing payload that follows the 4-byte data flags
 * for an Item record. Field shapes mirror fallout2-ce `proto.cc:objectDataRead`
 * (lines 583–599): armor/container/drug carry no trailer; weapon, ammo, misc,
 * and key each carry their type-specific int32 fields.
 *
 * Returns the new cursor offset and the field list to splice into the object
 * group. Caller is responsible for resolving `subType` (typically via the
 * pidtypes lookup) and for handling the unresolved case before reaching here.
 */
export function decodeItemSubtypeTrailer(
    data: Uint8Array,
    offset: number,
    subType: number,
): { fields: ParsedField[]; offset: number } {
    switch (subType) {
        case 3: // Weapon
            return {
                fields: [int32Field("Ammo Quantity", data, offset), int32Field("Ammo Type PID", data, offset + 4)],
                offset: offset + 8,
            };
        case 4: // Ammo
            return { fields: [int32Field("Quantity", data, offset)], offset: offset + 4 };
        case 5: // Misc
            return { fields: [int32Field("Charges", data, offset)], offset: offset + 4 };
        case 6: // Key
            return { fields: [int32Field("Key Code", data, offset)], offset: offset + 4 };
        default: // 0 Armor / 1 Container / 2 Drug — no trailer
            return { fields: [], offset };
    }
}

/**
 * Decode the per-subtype trailing payload for a Scenery record. Mirrors
 * fallout2-ce `proto.cc:objectDataRead` (lines 605–633). Ladders read 8 bytes
 * on v20 (Fallout 2) but only 4 bytes on v19 (Fallout 1, builtTile only).
 */
export function decodeScenerySubtypeTrailer(
    data: Uint8Array,
    offset: number,
    subType: number,
    mapVersion: number,
): { fields: ParsedField[]; offset: number } {
    switch (subType) {
        case 0: // Door
            return { fields: [int32Field("Open Flags", data, offset)], offset: offset + 4 };
        case 1: // Stairs
            return {
                fields: [
                    int32Field("Destination Built Tile", data, offset),
                    int32Field("Destination Map", data, offset + 4),
                ],
                offset: offset + 8,
            };
        case 2: // Elevator
            return {
                fields: [int32Field("Elevator Type", data, offset), int32Field("Level", data, offset + 4)],
                offset: offset + 8,
            };
        case 3: // Ladder Up
        case 4: // Ladder Down
            // v19 carries only destinationBuiltTile; v20 prepends destinationMap.
            if (mapVersion === 19) {
                return {
                    fields: [int32Field("Destination Built Tile", data, offset)],
                    offset: offset + 4,
                };
            }
            return {
                fields: [
                    int32Field("Destination Map", data, offset),
                    int32Field("Destination Built Tile", data, offset + 4),
                ],
                offset: offset + 8,
            };
        default: // 5 Generic — no trailer
            return { fields: [], offset };
    }
}

// Records the parser couldn't fully decode get `editingLocked: true` so the
// editor's tree builder threads it down to descendant fields. Field edits
// are width-preserving but not interpretation-preserving when the trailing
// payload is unknown — changing `inventoryLength` or the upper byte of `pid`
// (the type tag) would re-bind the opaque-trailer bytes to a different
// structure on reparse, silently corrupting the file.
function incompleteObjectResult(group: ParsedGroup, offset: number): ParsedObjectResult {
    return { complete: false, group: { ...group, editingLocked: true }, offset };
}

function parseObjectAt(
    data: Uint8Array,
    offset: number,
    index: string,
    header: MapHeader,
    errors: string[],
    options: ParseObjectsOptions,
): ParsedObjectResult {
    if (offset + MAP_OBJECT_BASE_SIZE + MAP_OBJECT_DATA_HEADER_SIZE > data.length) {
        errors.push(`Object ${index} truncated at offset 0x${offset.toString(16)}`);
        return incompleteObjectResult(
            makeGroup(`Object ${index}`, [noteField("TODO", "Truncated object data", offset)], true),
            data.length,
        );
    }

    const { fields: baseFields, pid } = parseObjectBaseFields(data, offset);
    const pidType = (pid >>> 24) & 0xff;
    let currentOffset = offset + MAP_OBJECT_BASE_SIZE;

    const { group: inventoryHeaderGroup, inventoryLength } = parseInventoryHeaderGroup(data, currentOffset);
    currentOffset += MAP_OBJECT_DATA_HEADER_SIZE;

    const objectFields: (ParsedField | ParsedGroup)[] = [...baseFields, inventoryHeaderGroup];

    if (pidType === PID_TYPE_CRITTER) {
        if (currentOffset + 44 > data.length) {
            errors.push(`Critter object ${index} payload truncated at offset 0x${currentOffset.toString(16)}`);
            objectFields.push(noteField("TODO", "Truncated critter payload", currentOffset));
            return incompleteObjectResult(
                makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                data.length,
            );
        }

        objectFields.push(parseCritterDataGroup(data, currentOffset));
        currentOffset += 44;
    } else {
        if (currentOffset + 4 > data.length) {
            errors.push(`Object ${index} flags truncated at offset 0x${currentOffset.toString(16)}`);
            objectFields.push(noteField("TODO", "Truncated object flags", currentOffset));
            return incompleteObjectResult(
                makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                data.length,
            );
        }

        objectFields.push(makeGroup("Object Data", [uint32Field("Data Flags", data, currentOffset)]));
        currentOffset += 4;

        if (pidType === PID_TYPE_MISC && isExitGridPid(pid)) {
            if (currentOffset + 16 > data.length) {
                errors.push(`Exit grid object ${index} payload truncated at offset 0x${currentOffset.toString(16)}`);
                objectFields.push(noteField("TODO", "Truncated exit grid payload", currentOffset));
                return incompleteObjectResult(
                    makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                    data.length,
                );
            }

            objectFields.push(parseExitGridGroup(data, currentOffset));
            currentOffset += 16;
        } else if (pidType === PID_TYPE_ITEM || pidType === PID_TYPE_SCENERY) {
            // Item / Scenery records carry a subtype-keyed payload after the data
            // header whose layout fallout2-ce determines via `proto->item.type` /
            // `proto->scenery.type` (proto.cc:objectDataRead). PROs are not
            // packaged alongside `.map` files in user mod trees, so we resolve
            // the subtype through a precomputed pid lookup. Unresolved pids
            // (modded territory not in the bundled table) keep the legacy
            // opaque-tail bail so the file still round-trips byte-identically.
            const resolver = options.pidResolver ?? resolvePidSubType;
            const subType = resolver(pid);
            if (subType === undefined) {
                objectFields.push(
                    noteField(
                        "TODO",
                        `Payload decoding for ${objectTypeName(pid)} pid 0x${(pid >>> 0)
                            .toString(16)
                            .padStart(8, "0")} needs a subtype mapping not in the default table`,
                        currentOffset,
                    ),
                );
                return incompleteObjectResult(
                    makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                    currentOffset,
                );
            }

            const decoded =
                pidType === PID_TYPE_ITEM
                    ? decodeItemSubtypeTrailer(data, currentOffset, subType)
                    : decodeScenerySubtypeTrailer(data, currentOffset, subType, header.version);
            const trailerEnd = decoded.offset;
            if (trailerEnd > data.length) {
                errors.push(`Object ${index} subtype trailer truncated at offset 0x${currentOffset.toString(16)}`);
                objectFields.push(noteField("TODO", "Truncated subtype trailer", currentOffset));
                return incompleteObjectResult(
                    makeGroup(`Object ${index} (${objectTypeName(pid)})`, objectFields),
                    data.length,
                );
            }
            if (decoded.fields.length > 0) {
                objectFields.push(makeGroup("Subtype Data", decoded.fields));
            }
            currentOffset = trailerEnd;
        }
    }

    const inventoryGroups: ParsedGroup[] = [];
    const safeInventoryLength = clampObjectCount(
        inventoryLength,
        `inventory entries for object ${index}`,
        data.length - currentOffset,
        MIN_INVENTORY_ENTRY_BYTES,
        errors,
    );
    for (let inventoryIndex = 0; inventoryIndex < safeInventoryLength; inventoryIndex++) {
        if (currentOffset + 4 > data.length) {
            errors.push(
                `Inventory entry ${index}.${inventoryIndex} quantity truncated at offset 0x${currentOffset.toString(16)}`,
            );
            objectFields.push(noteField("TODO", "Truncated inventory entry", currentOffset));
            return incompleteObjectResult(
                makeGroup(`Object ${index} (${objectTypeName(pid)})`, [...objectFields, ...inventoryGroups]),
                data.length,
            );
        }

        const quantityField = int32Field("Quantity", data, currentOffset);
        currentOffset += 4;

        const nestedObject = parseObjectAt(data, currentOffset, `${index}.${inventoryIndex}`, header, errors, options);
        inventoryGroups.push(makeGroup(`Inventory Entry ${inventoryIndex}`, [quantityField, nestedObject.group]));
        currentOffset = nestedObject.offset;

        if (!nestedObject.complete) {
            return incompleteObjectResult(
                makeGroup(`Object ${index} (${objectTypeName(pid)})`, [...objectFields, ...inventoryGroups]),
                currentOffset,
            );
        }
    }

    return {
        complete: true,
        group: makeGroup(`Object ${index} (${objectTypeName(pid)})`, [...objectFields, ...inventoryGroups]),
        offset: currentOffset,
    };
}

export function parseObjects(
    data: Uint8Array,
    header: MapHeader,
    currentOffset: number,
    errors: string[],
    options: ParseObjectsOptions = {},
): { offset: number; group: ParsedGroup; opaqueTailOffset?: number } {
    if (currentOffset >= data.length) {
        return {
            offset: currentOffset,
            group: makeGroup("Objects Section", [
                { name: "Total Objects", value: 0, offset: currentOffset, size: 0, type: "int32" },
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
            sectionFields.push(
                makeGroup(`Elevation ${elev} Objects`, [
                    noteField("TODO", "Truncated elevation object count", currentOffset),
                ]),
            );
            return { offset: data.length, group: makeGroup("Objects Section", sectionFields) };
        }

        const countField = int32Field("Object Count", data, currentOffset);
        currentOffset += 4;

        const elevationFields: (ParsedField | ParsedGroup)[] = [countField];
        const safeObjectCount = clampObjectCount(
            Number(countField.value),
            `top-level objects on elevation ${elev}`,
            data.length - currentOffset,
            MIN_OBJECT_BYTES,
            errors,
        );
        for (let objectIndex = 0; objectIndex < safeObjectCount; objectIndex++) {
            const parsedObject = parseObjectAt(data, currentOffset, `${elev}.${objectIndex}`, header, errors, options);
            elevationFields.push(parsedObject.group);
            currentOffset = parsedObject.offset;

            if (!parsedObject.complete) {
                const remainingObjects = safeObjectCount - objectIndex - 1;
                if (remainingObjects > 0) {
                    elevationFields.push(
                        noteField(
                            "TODO",
                            `${remainingObjects} more top-level object(s) on elevation ${elev} require a PRO resolver or a fuller object model to decode safely`,
                            currentOffset,
                        ),
                    );
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
        const hasOnlyZeroCounts =
            totalObjects.value === 0 &&
            sectionFields
                .filter(
                    (entry): entry is ParsedGroup => "fields" in entry && /^Elevation \d+ Objects$/.test(entry.name),
                )
                .every((entry) => fieldNumber(entry, "Object Count") === 0);

        sectionFields.push(
            noteField(
                "TODO",
                hasOnlyZeroCounts
                    ? `Unable to confidently decode object section: script/object boundary is ambiguous near offset 0x${currentOffset.toString(16)}; preserving remaining bytes opaquely`
                    : `Opaque trailing object bytes remain from offset 0x${currentOffset.toString(16)}; full decoding requires PRO-backed subtype resolution`,
                currentOffset,
            ),
        );

        return {
            offset: data.length,
            group: makeGroup("Objects Section", sectionFields),
            opaqueTailOffset: currentOffset,
        };
    }

    return { offset: data.length, group: makeGroup("Objects Section", sectionFields) };
}
