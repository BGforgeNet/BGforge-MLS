/**
 * Parse functions for MAP object data (base fields, critter data, exit grids, inventory).
 */

import type { ParsedField, ParsedGroup } from "./types";
import { MapElevation, Rotation, ObjectFlags } from "./map-types";
import type { MapHeader } from "./map-schemas";
import {
    makeGroup,
    flagsField,
    enumField,
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
} from "./map-parse-helpers";

type ParsedObjectResult = {
    complete: boolean;
    group: ParsedGroup;
    offset: number;
};

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
        enumField(
            "Rotation",
            new DataView(data.buffer, data.byteOffset + offset + 28, 4).getInt32(0, false),
            Rotation,
            offset + 28,
            4,
        ),
        uint32Field("FID", data, offset + 32),
        flagsField(
            "Flags",
            new DataView(data.buffer, data.byteOffset + offset + 36, 4).getInt32(0, false),
            ObjectFlags,
            offset + 36,
            4,
        ),
        enumField(
            "Elevation",
            new DataView(data.buffer, data.byteOffset + offset + 40, 4).getInt32(0, false),
            MapElevation,
            offset + 40,
            4,
        ),
        { name: "PID", value: pid, offset: pidFieldOffset, size: 4, type: "int32" as const },
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
        enumField(
            "Destination Elevation",
            new DataView(data.buffer, data.byteOffset + offset + 8, 4).getInt32(0, false),
            MapElevation,
            offset + 8,
            4,
        ),
        enumField(
            "Destination Rotation",
            new DataView(data.buffer, data.byteOffset + offset + 12, 4).getInt32(0, false),
            Rotation,
            offset + 12,
            4,
        ),
    ];
}

function parseObjectAt(
    data: Uint8Array,
    offset: number,
    index: string,
    header: MapHeader,
    errors: string[],
): ParsedObjectResult {
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
    const pidType = (pid >>> 24) & 0xff;
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
            objectFields.push(
                noteField(
                    "TODO",
                    "Payload decoding for item/scenery objects requires external PRO metadata to resolve subtype-specific layout",
                    currentOffset,
                ),
            );
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
            errors.push(
                `Inventory entry ${index}.${inventoryIndex} quantity truncated at offset 0x${currentOffset.toString(16)}`,
            );
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

export function parseObjects(
    data: Uint8Array,
    header: MapHeader,
    currentOffset: number,
    errors: string[],
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
        for (let objectIndex = 0; objectIndex < Number(countField.value); objectIndex++) {
            const parsedObject = parseObjectAt(data, currentOffset, `${elev}.${objectIndex}`, header, errors);
            elevationFields.push(parsedObject.group);
            currentOffset = parsedObject.offset;

            if (!parsedObject.complete) {
                const remainingObjects = Number(countField.value) - objectIndex - 1;
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
