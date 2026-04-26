import { BufferReader } from "typed-binary";
import type { BinaryParser, ParseOptions, ParseResult, ParsedGroup, ParsedField, ParsedFieldType } from "../types";
import { walkStruct } from "../spec/walk-display";
import { armorSpec, armorPresentation } from "./specs/armor";
import { headerSpec, headerPresentation } from "./specs/header";
import { itemCommonSpec, itemCommonPresentation } from "./specs/item-common";
import { sceneryCommonSpec, sceneryCommonPresentation } from "./specs/scenery-common";
import { wallSpec, wallPresentation } from "./specs/wall";
import { weaponSpec, weaponPresentation } from "./specs/weapon";
import { ammoSpec, ammoPresentation } from "./specs/ammo";
import { containerSpec, containerPresentation } from "./specs/container";
import { drugSpec, drugPresentation } from "./specs/drug";
import { miscItemSpec, miscItemPresentation } from "./specs/misc-item";
import { keySpec, keyPresentation } from "./specs/key";
import { doorSpec, doorPresentation } from "./specs/door";
import { elevatorSpec, elevatorPresentation } from "./specs/elevator";
import { genericScenerySpec, genericSceneryPresentation } from "./specs/generic-scenery";
import { tileSpec, tilePresentation } from "./specs/tile";
import { miscSpec, miscPresentation } from "./specs/misc";
import { createProCanonicalSnapshot } from "./canonical";
import { serializePro } from "./serializer";
import {
    type CritterFieldDef,
    ObjectType,
    DamageType,
    BodyType,
    KillType,
    ScriptType,
    CritterFlags,
    HEADER_SIZE,
    ITEM_COMMON_SIZE,
    ITEM_SUBTYPE_OFFSET,
    ITEM_SUBTYPE_SIZES,
    CRITTER_SIZE,
    SCENERY_COMMON_SIZE,
    SCENERY_SUBTYPE_OFFSET,
    SCENERY_SUBTYPE_SIZES,
    WALL_SIZE,
    TILE_SIZE,
    MISC_SIZE,
    CRITTER_PROPERTIES,
    CRITTER_BASE_PRIMARY,
    CRITTER_BASE_SECONDARY,
    CRITTER_BASE_DT,
    CRITTER_BASE_DR,
    CRITTER_BONUS_PRIMARY,
    CRITTER_BONUS_SECONDARY,
    CRITTER_BONUS_DT,
    CRITTER_BONUS_DR,
    CRITTER_SKILLS,
} from "./types";
import {
    headerSchema,
    itemCommonSchema,
    armorSchema,
    containerSchema,
    drugSchema,
    weaponSchema,
    ammoSchema,
    miscItemSchema,
    keySchema,
    critterSchema,
    sceneryCommonSchema,
    doorSchema,
    stairsSchema,
    elevatorSchema,
    ladderSchema,
    genericScenerySchema,
    wallSchema,
    tileSchema,
    miscSchema,
    type HeaderData,
    type ItemCommonData,
    type ArmorData,
    type ContainerData,
    type DrugData,
    type WeaponData,
    type AmmoData,
    type MiscItemData,
    type KeyData,
    type CritterData,
    type SceneryCommonData,
    type DoorData,
    type StairsData,
    type ElevatorData,
    type LadderData,
    type GenericSceneryData,
    type WallData,
    type TileData,
    type MiscData,
} from "./schemas";

/**
 * Create a big-endian BufferReader from a Uint8Array, optionally starting at byteOffset
 */
function reader(data: Uint8Array, byteOffset = 0): BufferReader {
    return new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset + byteOffset });
}

/**
 * Parse flags into array of names
 */
function parseFlags(value: number, flagDefs: Record<number, string>): string[] {
    const flags: string[] = [];
    for (const [bit, name] of Object.entries(flagDefs)) {
        const bitVal = Number(bit);
        if (bitVal === 0) {
            // Special case: 0 means default/no flags set for this position
            if (value === 0) flags.push(name);
        } else if (value & bitVal) {
            flags.push(name);
        }
    }
    return flags;
}

/**
 * Helper to format a percent value
 */
function percent(value: number): string {
    return `${value}%`;
}

/**
 * Helper to create a ParsedField
 */
function field(
    name: string,
    value: unknown,
    offset: number,
    size: number,
    type: ParsedFieldType,
    description?: string,
    rawValue?: number,
): ParsedField {
    return { name, value, offset, size, type, description, rawValue };
}

/**
 * Helper to validate enum value and create a ParsedField
 */
function enumField(
    name: string,
    value: number,
    lookup: Record<number, string>,
    offset: number,
    size: number,
    errors: string[],
): ParsedField {
    const resolved = lookup[value];
    if (resolved === undefined) {
        errors.push(`Invalid ${name} at offset 0x${offset.toString(16)}: ${value}`);
    }
    return field(name, resolved ?? `Unknown (${value})`, offset, size, "enum", undefined, value);
}

/**
 * Helper to create a flags field with parsed names
 */
function flagsField(
    name: string,
    value: number,
    flagDefs: Record<number, string>,
    offset: number,
    size: number,
): ParsedField {
    const flags = parseFlags(value, flagDefs);
    const display = flags.length > 0 ? flags.join(", ") : "(none)";
    return field(name, display, offset, size, "flags", undefined, value);
}

/**
 * Helper to create a ParsedGroup
 */
function group(
    name: string,
    fields: (ParsedField | ParsedGroup)[],
    expanded = true,
    description?: string,
): ParsedGroup {
    return { name, fields, expanded, description };
}

/**
 * Generate fields from data-driven definitions
 */
function fieldsFromDefs(defs: CritterFieldDef[], data: Record<string, number>, errors: string[]): ParsedField[] {
    return defs.map(([displayName, dataKey, offset, type]) => {
        const value = data[dataKey] ?? 0;
        if (type === "percent") {
            return field(displayName, percent(value), offset, 4, "int32");
        }
        if (type === "scriptType") {
            return enumField(displayName, value, ScriptType, offset, 1, errors);
        }
        if (type === "scriptId") {
            return field(displayName, value, offset, 3, "int24");
        }
        return field(displayName, value, offset, 4, type);
    });
}

/**
 * Parse header into structured format
 */
function parseHeader(data: HeaderData): ParsedGroup {
    return walkStruct(headerSpec, headerPresentation, 0, data, "Header");
}

/**
 * Parse item common fields
 */
function parseItemCommon(data: ItemCommonData, baseOffset: number): ParsedGroup {
    return walkStruct(itemCommonSpec, itemCommonPresentation, baseOffset, data, "Item Properties");
}

/**
 * Parse armor subtype
 */
function parseArmor(data: ArmorData, baseOffset: number): ParsedGroup {
    return walkStruct(armorSpec, armorPresentation, baseOffset, data, "Armor Stats", {
        subGroups: [
            {
                name: "Damage Resistance",
                fields: ["drNormal", "drLaser", "drFire", "drPlasma", "drElectrical", "drEmp", "drExplosion"],
            },
            {
                name: "Damage Threshold",
                fields: ["dtNormal", "dtLaser", "dtFire", "dtPlasma", "dtElectrical", "dtEmp", "dtExplosion"],
            },
        ],
    });
}

/**
 * Parse weapon subtype
 */
function parseWeapon(data: WeaponData, baseOffset: number): ParsedGroup {
    return walkStruct(weaponSpec, weaponPresentation, baseOffset, data, "Weapon Stats");
}

/**
 * Parse ammo subtype
 */
function parseAmmo(data: AmmoData, baseOffset: number): ParsedGroup {
    return walkStruct(ammoSpec, ammoPresentation, baseOffset, data, "Ammo Stats");
}

/**
 * Parse container subtype
 */
function parseContainer(data: ContainerData, baseOffset: number): ParsedGroup {
    return walkStruct(containerSpec, containerPresentation, baseOffset, data, "Container Stats");
}

/**
 * Parse drug subtype
 */
function parseDrug(data: DrugData, baseOffset: number): ParsedGroup {
    return walkStruct(drugSpec, drugPresentation, baseOffset, data, "Drug Stats", {
        subGroups: [
            { name: "Affected Stats", fields: ["stat0", "stat1", "stat2"], expanded: true },
            {
                name: "Instant Effect",
                fields: ["amount0Instant", "amount1Instant", "amount2Instant"],
                expanded: true,
            },
            {
                name: "Delayed Effect 1",
                fields: ["duration1", "amount0Delayed1", "amount1Delayed1", "amount2Delayed1"],
            },
            {
                name: "Delayed Effect 2",
                fields: ["duration2", "amount0Delayed2", "amount1Delayed2", "amount2Delayed2"],
            },
            {
                name: "Addiction",
                fields: ["addictionRate", "addictionEffect", "addictionOnset"],
                expanded: true,
            },
        ],
    });
}

/**
 * Parse misc item subtype
 */
function parseMiscItem(data: MiscItemData, baseOffset: number): ParsedGroup {
    return walkStruct(miscItemSpec, miscItemPresentation, baseOffset, data, "Misc Item Stats");
}

/**
 * Parse key subtype
 */
function parseKey(data: KeyData, baseOffset: number): ParsedGroup {
    return walkStruct(keySpec, keyPresentation, baseOffset, data, "Key Stats");
}

/**
 * Parse critter data using data-driven field definitions
 */
function parseCritter(data: CritterData, errors: string[]): ParsedGroup[] {
    // CritterData has known numeric fields - index signature for dynamic access
    const critterData: Record<string, number> = data;

    return [
        group("Critter Properties", [
            field(
                "Flags Ext",
                `0x${data.flagsExt.toString(16).padStart(8, "0")}`,
                0x18,
                4,
                "flags",
                undefined,
                data.flagsExt,
            ),
            ...fieldsFromDefs(CRITTER_PROPERTIES, critterData, errors),
            flagsField("Critter Flags", data.critterFlags, CritterFlags, 0x2c, 4),
        ]),
        group("Base Primary Stats", fieldsFromDefs(CRITTER_BASE_PRIMARY, critterData, errors)),
        group("Base Secondary Stats", fieldsFromDefs(CRITTER_BASE_SECONDARY, critterData, errors)),
        group("Base Damage Threshold", fieldsFromDefs(CRITTER_BASE_DT, critterData, errors), false),
        group("Base Damage Resistance", fieldsFromDefs(CRITTER_BASE_DR, critterData, errors), false),
        group("Demographics", [
            field("Age", data.age, 0xb4, 4, "int32"),
            field("Gender", data.gender === 0 ? "Male" : "Female", 0xb8, 4, "enum", undefined, data.gender),
        ]),
        group("Bonus Primary Stats", fieldsFromDefs(CRITTER_BONUS_PRIMARY, critterData, errors), false),
        group("Bonus Secondary Stats", fieldsFromDefs(CRITTER_BONUS_SECONDARY, critterData, errors), false),
        group("Bonus Damage Threshold", fieldsFromDefs(CRITTER_BONUS_DT, critterData, errors), false),
        group("Bonus Damage Resistance", fieldsFromDefs(CRITTER_BONUS_DR, critterData, errors), false),
        group("Skills", fieldsFromDefs(CRITTER_SKILLS, critterData, errors)),
        group("Final Properties", [
            enumField("Body Type", data.bodyType, BodyType, 0x1_90, 4, errors),
            field("Experience Value", data.expValue, 0x1_94, 4, "uint32"),
            enumField("Kill Type", data.killType, KillType, 0x1_98, 4, errors),
            enumField("Damage Type", data.damageType, DamageType, 0x1_9c, 4, errors),
        ]),
    ];
}

/**
 * Parse scenery common and subtypes
 */
function parseScenery(data: Uint8Array, scenery: SceneryCommonData, _errors: string[]): ParsedGroup[] {
    const groups: ParsedGroup[] = [];

    groups.push(walkStruct(sceneryCommonSpec, sceneryCommonPresentation, 0x18, scenery, "Scenery Properties"));

    switch (scenery.subType) {
        case 0: {
            // Door
            const door: DoorData = doorSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            groups.push(parseDoor(door));
            break;
        }
        case 1: {
            // Stairs
            const stairs: StairsData = stairsSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            const destTile = stairs.destTileAndElevation & 0x3_ff_ff_ff;
            const destElev = (stairs.destTileAndElevation >> 26) & 0x3f;
            groups.push(
                group("Stairs Properties", [
                    field("Dest Tile", destTile, 0x29, 4, "uint32"),
                    field("Dest Elevation", destElev, 0x29, 4, "uint32"),
                    field("Dest Map", stairs.destMap, 0x2d, 4, "uint32"),
                ]),
            );
            break;
        }
        case 2: {
            // Elevator
            const elevator: ElevatorData = elevatorSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            groups.push(parseElevator(elevator));
            break;
        }
        case 3: // Ladder Bottom
        case 4: {
            // Ladder Top
            const ladder: LadderData = ladderSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            const destTile = ladder.destTileAndElevation & 0x3_ff_ff_ff;
            const destElev = (ladder.destTileAndElevation >> 26) & 0x3f;
            groups.push(
                group("Ladder Properties", [
                    field("Dest Tile", destTile, 0x29, 4, "uint32"),
                    field("Dest Elevation", destElev, 0x29, 4, "uint32"),
                ]),
            );
            break;
        }
        case 5: {
            // Generic
            const genScenery: GenericSceneryData = genericScenerySchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            groups.push(parseGenericScenery(genScenery));
            break;
        }
    }

    return groups;
}

/**
 * Parse door scenery subtype
 */
function parseDoor(data: DoorData): ParsedGroup {
    return walkStruct(doorSpec, doorPresentation, 0x29, data, "Door Properties");
}

/**
 * Parse elevator scenery subtype
 */
function parseElevator(data: ElevatorData): ParsedGroup {
    return walkStruct(elevatorSpec, elevatorPresentation, 0x29, data, "Elevator Properties");
}

/**
 * Parse generic scenery subtype
 */
function parseGenericScenery(data: GenericSceneryData): ParsedGroup {
    return walkStruct(genericScenerySpec, genericSceneryPresentation, 0x29, data, "Generic Properties");
}

/**
 * Parse wall data
 */
function parseWall(data: WallData): ParsedGroup {
    return walkStruct(wallSpec, wallPresentation, 0x18, data, "Wall Properties");
}

/**
 * Parse tile data
 */
function parseTile(data: TileData): ParsedGroup {
    return walkStruct(tileSpec, tilePresentation, 0x18, data, "Tile Properties");
}

/**
 * Parse misc data
 */
function parseMisc(data: MiscData): ParsedGroup {
    return walkStruct(miscSpec, miscPresentation, 0x18, data, "Misc Properties");
}

// Maximum file size for PRO files (largest is critter at 416 bytes, add margin)
const MAX_PRO_SIZE = 1024;

/**
 * PRO file parser implementation
 */
class ProParser implements BinaryParser {
    readonly id = "pro";
    readonly name = "Fallout PRO (Prototype)";
    readonly extensions = ["pro"];

    private fail(message: string): ParseResult {
        return {
            format: this.id,
            formatName: this.name,
            root: group("PRO File", []),
            errors: [message],
        };
    }

    parse(data: Uint8Array, _options?: ParseOptions): ParseResult {
        try {
            return this.parseInternal(data);
        } catch (err) {
            return this.fail(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    serialize(result: ParseResult): Uint8Array {
        return serializePro(result);
    }

    private parseInternal(data: Uint8Array): ParseResult {
        const fileSize = data.length;

        // Validate file size limits
        if (fileSize > MAX_PRO_SIZE) {
            return this.fail(`File too large: ${fileSize} bytes, max ${MAX_PRO_SIZE}`);
        }
        if (fileSize < HEADER_SIZE) {
            return this.fail(`File too small: ${fileSize} bytes, need at least ${HEADER_SIZE} for header`);
        }

        // Parse header to determine type
        const header: HeaderData = headerSchema.read(reader(data));
        const objectType = header.objectType;

        // Validate file size based on object type
        let expectedSize: number;
        let subType: number | undefined;

        switch (objectType) {
            case 0: {
                // Item
                if (fileSize < HEADER_SIZE + ITEM_COMMON_SIZE) {
                    return this.fail(
                        `Item file too small: ${fileSize} bytes, need at least ${HEADER_SIZE + ITEM_COMMON_SIZE}`,
                    );
                }
                const itemCommon: ItemCommonData = itemCommonSchema.read(reader(data, HEADER_SIZE));
                subType = itemCommon.subType;
                const subTypeSize = ITEM_SUBTYPE_SIZES[subType as number];
                if (subTypeSize === undefined) {
                    return this.fail(`Unknown item subtype: ${subType}`);
                }
                expectedSize = HEADER_SIZE + ITEM_COMMON_SIZE + subTypeSize;
                break;
            }
            case 1: // Critter
                expectedSize = CRITTER_SIZE;
                break;
            case 2: {
                // Scenery
                if (fileSize < HEADER_SIZE + SCENERY_COMMON_SIZE) {
                    return this.fail(
                        `Scenery file too small: ${fileSize} bytes, need at least ${HEADER_SIZE + SCENERY_COMMON_SIZE}`,
                    );
                }
                const sceneryCommon: SceneryCommonData = sceneryCommonSchema.read(reader(data, HEADER_SIZE));
                subType = sceneryCommon.subType;
                const subTypeSize = SCENERY_SUBTYPE_SIZES[subType as number];
                if (subTypeSize === undefined) {
                    return this.fail(`Unknown scenery subtype: ${subType}`);
                }
                expectedSize = HEADER_SIZE + SCENERY_COMMON_SIZE + subTypeSize;
                break;
            }
            case 3: // Wall
                expectedSize = WALL_SIZE;
                break;
            case 4: // Tile
                expectedSize = TILE_SIZE;
                break;
            case 5: // Misc
                expectedSize = MISC_SIZE;
                break;
            default:
                return this.fail(`Unknown object type: ${objectType}`);
        }

        if (fileSize !== expectedSize) {
            const typeName = ObjectType[objectType] || `Type ${objectType}`;
            return this.fail(`Invalid ${typeName} file size: got ${fileSize} bytes, expected ${expectedSize}`);
        }

        // Now parse the validated file
        const errors: string[] = [];
        const headerGroup = parseHeader(header);
        const groups: (ParsedField | ParsedGroup)[] = [headerGroup];

        switch (objectType) {
            case 0: {
                // Item
                const itemCommon: ItemCommonData = itemCommonSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseItemCommon(itemCommon, HEADER_SIZE));

                switch (itemCommon.subType) {
                    case 0: // Armor
                        groups.push(
                            parseArmor(armorSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET),
                        );
                        break;
                    case 1: // Container
                        groups.push(
                            parseContainer(
                                containerSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)),
                                ITEM_SUBTYPE_OFFSET,
                            ),
                        );
                        break;
                    case 2: // Drug
                        groups.push(parseDrug(drugSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    case 3: // Weapon
                        groups.push(
                            parseWeapon(weaponSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET),
                        );
                        break;
                    case 4: // Ammo
                        groups.push(parseAmmo(ammoSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    case 5: // Misc
                        groups.push(
                            parseMiscItem(miscItemSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET),
                        );
                        break;
                    case 6: // Key
                        groups.push(parseKey(keySchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    default:
                        return this.fail(`Unknown item subtype: ${itemCommon.subType}`);
                }
                break;
            }
            case 1: {
                // Critter
                const critter: CritterData = critterSchema.read(reader(data, HEADER_SIZE));
                groups.push(...parseCritter(critter, errors));
                break;
            }
            case 2: {
                // Scenery
                const scenery: SceneryCommonData = sceneryCommonSchema.read(reader(data, HEADER_SIZE));
                groups.push(...parseScenery(data, scenery, errors));
                break;
            }
            case 3: {
                // Wall
                const wall: WallData = wallSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseWall(wall));
                break;
            }
            case 4: {
                // Tile
                const tile: TileData = tileSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseTile(tile));
                break;
            }
            case 5: {
                // Misc
                const misc: MiscData = miscSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseMisc(misc));
                break;
            }
        }

        const result: ParseResult = {
            format: this.id,
            formatName: this.name,
            root: group("PRO File", groups),
            errors: errors.length > 0 ? errors : undefined,
        };
        try {
            result.document = createProCanonicalSnapshot(result).document;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.warnings = [...(result.warnings ?? []), `Canonical PRO document unavailable: ${message}`];
        }
        return result;
    }
}

export const proParser = new ProParser();
