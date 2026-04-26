/**
 * Writer helpers for serializing ProCanonicalSnapshot/ProCanonicalDocument
 * back to binary PRO format bytes.
 */

import { BufferWriter } from "typed-binary";
import { parseWithSchemaValidation } from "../schema-validation";
import {
    ammoSchema,
    armorSchema,
    containerSchema,
    critterSchema,
    doorSchema,
    drugSchema,
    elevatorSchema,
    genericScenerySchema,
    headerSchema,
    itemCommonSchema,
    keySchema,
    ladderSchema,
    miscItemSchema,
    miscSchema,
    sceneryCommonSchema,
    stairsSchema,
    tileSchema,
    wallSchema,
    weaponSchema,
} from "./schemas";
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
import { proCanonicalSnapshotSchema, type ProCanonicalSnapshot, type ProCanonicalDocument } from "./canonical-schemas";

function writer(data: Uint8Array, offset = 0): BufferWriter {
    return new BufferWriter(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

function packDestTileAndElevation(destTile: number, destElevation: number): number {
    return ((destElevation & 0x3f) << 26) | (destTile & 0x03_ff_ff_ff);
}

export function serializeProCanonicalSnapshot(snapshot: ProCanonicalSnapshot): Uint8Array {
    const { header, sections } = snapshot.document;
    let size = HEADER_SIZE;

    switch (header.objectType) {
        case 0:
            if (!sections.itemProperties) throw new Error("itemProperties is required");
            size = ITEM_SUBTYPE_OFFSET + (ITEM_SUBTYPE_SIZES[sections.itemProperties.subType] ?? 0);
            break;
        case 1:
            size = CRITTER_SIZE;
            break;
        case 2:
            if (!sections.sceneryProperties) throw new Error("sceneryProperties is required");
            size = SCENERY_SUBTYPE_OFFSET + (SCENERY_SUBTYPE_SIZES[sections.sceneryProperties.subType] ?? 0);
            break;
        case 3:
            size = WALL_SIZE;
            break;
        case 4:
            size = TILE_SIZE;
            break;
        case 5:
            size = MISC_SIZE;
            break;
    }

    const data = new Uint8Array(size);
    headerSchema.write(writer(data), header);

    switch (header.objectType) {
        case 0: {
            const item = sections.itemProperties!;
            itemCommonSchema.write(writer(data, HEADER_SIZE), item);
            switch (item.subType) {
                case 0:
                    armorSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.armorStats!);
                    break;
                case 1:
                    containerSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.containerStats!);
                    break;
                case 2:
                    drugSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.drugStats!);
                    break;
                case 3:
                    weaponSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.weaponStats!);
                    break;
                case 4:
                    ammoSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.ammoStats!);
                    break;
                case 5:
                    miscItemSchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.miscItemStats!);
                    break;
                case 6:
                    keySchema.write(writer(data, ITEM_SUBTYPE_OFFSET), sections.keyStats!);
                    break;
            }
            break;
        }
        case 1: {
            critterSchema.write(writer(data, HEADER_SIZE), sections.critterStats!);
            break;
        }
        case 2: {
            const scenery = sections.sceneryProperties!;
            sceneryCommonSchema.write(writer(data, HEADER_SIZE), scenery);
            switch (scenery.subType) {
                case 0:
                    doorSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), sections.doorProperties!);
                    break;
                case 1:
                    stairsSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), {
                        destTileAndElevation: packDestTileAndElevation(
                            sections.stairsProperties!.destTile,
                            sections.stairsProperties!.destElevation,
                        ),
                        destMap: sections.stairsProperties!.destMap,
                    });
                    break;
                case 2:
                    elevatorSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), sections.elevatorProperties!);
                    break;
                case 3:
                case 4:
                    ladderSchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), {
                        destTileAndElevation: packDestTileAndElevation(
                            sections.ladderProperties!.destTile,
                            sections.ladderProperties!.destElevation,
                        ),
                    });
                    break;
                case 5:
                    genericScenerySchema.write(writer(data, SCENERY_SUBTYPE_OFFSET), sections.genericProperties!);
                    break;
            }
            break;
        }
        case 3:
            wallSchema.write(writer(data, HEADER_SIZE), sections.wallProperties!);
            break;
        case 4:
            tileSchema.write(writer(data, HEADER_SIZE), sections.tileProperties!);
            break;
        case 5:
            miscSchema.write(writer(data, HEADER_SIZE), sections.miscProperties!);
            break;
    }

    return data;
}

export function serializeProCanonicalDocument(
    document: ProCanonicalDocument,
    formatName = "Fallout PRO (Prototype)",
): Uint8Array {
    return serializeProCanonicalSnapshot(
        parseWithSchemaValidation(
            proCanonicalSnapshotSchema,
            {
                schemaVersion: 1,
                format: "pro",
                formatName,
                document,
            },
            "Invalid PRO canonical document",
        ),
    );
}
