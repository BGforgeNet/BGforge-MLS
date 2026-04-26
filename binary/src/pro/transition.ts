import { BufferReader, BufferWriter } from "typed-binary";
import { getProCanonicalDocument, rebuildProCanonicalDocument, serializeProCanonicalDocument } from "./canonical";
import { headerSchema, itemCommonSchema, sceneryCommonSchema } from "./schemas";
import {
    CRITTER_SIZE,
    HEADER_SIZE,
    ITEM_SUBTYPE_OFFSET,
    ITEM_SUBTYPE_SIZES,
    MISC_SIZE,
    SCENERY_SUBTYPE_OFFSET,
    SCENERY_SUBTYPE_SIZES,
    TILE_SIZE,
    WALL_SIZE,
} from "./types";
import type { ParseResult } from "../types";

function reader(data: Uint8Array, offset = 0): BufferReader {
    return new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

function writer(data: Uint8Array, offset = 0): BufferWriter {
    return new BufferWriter(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

function parseFieldId(fieldId: string): string[] | undefined {
    try {
        const segments = JSON.parse(fieldId) as unknown;
        if (!Array.isArray(segments) || !segments.every((segment) => typeof segment === "string")) {
            return undefined;
        }
        return segments;
    } catch {
        return undefined;
    }
}

function getDefaultSizeForObjectType(objectType: number): number | undefined {
    switch (objectType) {
        case 0:
            return ITEM_SUBTYPE_OFFSET + (ITEM_SUBTYPE_SIZES[0] ?? 0);
        case 1:
            return CRITTER_SIZE;
        case 2:
            return SCENERY_SUBTYPE_OFFSET + (SCENERY_SUBTYPE_SIZES[0] ?? 0);
        case 3:
            return WALL_SIZE;
        case 4:
            return TILE_SIZE;
        case 5:
            return MISC_SIZE;
        default:
            return undefined;
    }
}

function buildObjectTypeTransitionBytes(currentBytes: Uint8Array, objectType: number): Uint8Array | undefined {
    const nextSize = getDefaultSizeForObjectType(objectType);
    if (!nextSize) {
        return undefined;
    }

    const nextBytes = new Uint8Array(nextSize);
    nextBytes.set(currentBytes.subarray(0, Math.min(HEADER_SIZE, currentBytes.length)));

    const header = headerSchema.read(reader(currentBytes));
    headerSchema.write(writer(nextBytes), {
        ...header,
        objectType,
    });

    if (objectType === 0) {
        itemCommonSchema.write(writer(nextBytes, HEADER_SIZE), {
            flagsExt: 0,
            attackModes: 0,
            scriptType: -1,
            scriptId: -1,
            subType: 0,
            materialId: 0,
            size: 0,
            weight: 0,
            cost: 0,
            inventoryFrmId: 0,
            soundId: 0,
        });
    } else if (objectType === 2) {
        sceneryCommonSchema.write(writer(nextBytes, HEADER_SIZE), {
            wallLightFlags: 0,
            actionFlags: 0,
            scriptType: -1,
            scriptId: -1,
            subType: 0,
            materialId: 0,
            soundId: 0,
        });
    }

    return nextBytes;
}

function buildItemSubtypeTransitionBytes(currentBytes: Uint8Array, subType: number): Uint8Array | undefined {
    const extraSize = ITEM_SUBTYPE_SIZES[subType];
    if (extraSize === undefined) {
        return undefined;
    }

    const nextBytes = new Uint8Array(ITEM_SUBTYPE_OFFSET + extraSize);
    nextBytes.set(currentBytes.subarray(0, Math.min(ITEM_SUBTYPE_OFFSET, currentBytes.length)));

    const itemCommon = itemCommonSchema.read(reader(currentBytes, HEADER_SIZE));
    itemCommonSchema.write(writer(nextBytes, HEADER_SIZE), {
        ...itemCommon,
        subType,
    });
    return nextBytes;
}

function buildScenerySubtypeTransitionBytes(currentBytes: Uint8Array, subType: number): Uint8Array | undefined {
    const extraSize = SCENERY_SUBTYPE_SIZES[subType];
    if (extraSize === undefined) {
        return undefined;
    }

    const nextBytes = new Uint8Array(SCENERY_SUBTYPE_OFFSET + extraSize);
    nextBytes.set(currentBytes.subarray(0, Math.min(SCENERY_SUBTYPE_OFFSET, currentBytes.length)));

    const sceneryCommon = sceneryCommonSchema.read(reader(currentBytes, HEADER_SIZE));
    sceneryCommonSchema.write(writer(nextBytes, HEADER_SIZE), {
        ...sceneryCommon,
        subType,
    });
    return nextBytes;
}

export function isProStructuralFieldId(fieldId: string): boolean {
    const segments = parseFieldId(fieldId);
    if (!segments) {
        return false;
    }

    return (
        (segments.length === 2 && segments[0] === "Header" && segments[1] === "Object Type") ||
        (segments.length === 2 && segments[0] === "Item Properties" && segments[1] === "Sub Type") ||
        (segments.length === 2 && segments[0] === "Scenery Properties" && segments[1] === "Sub Type")
    );
}

export function buildProStructuralTransitionBytes(
    parseResult: ParseResult,
    fieldId: string,
    rawValue: number,
): Uint8Array | undefined {
    const segments = parseFieldId(fieldId);
    if (!segments) {
        return undefined;
    }

    const document = getProCanonicalDocument(parseResult) ?? rebuildProCanonicalDocument(parseResult);
    const currentBytes = serializeProCanonicalDocument(document, parseResult.formatName);

    if (segments[0] === "Header" && segments[1] === "Object Type") {
        return buildObjectTypeTransitionBytes(currentBytes, rawValue);
    }
    if (segments[0] === "Item Properties" && segments[1] === "Sub Type") {
        return buildItemSubtypeTransitionBytes(currentBytes, rawValue);
    }
    if (segments[0] === "Scenery Properties" && segments[1] === "Sub Type") {
        return buildScenerySubtypeTransitionBytes(currentBytes, rawValue);
    }

    return undefined;
}
