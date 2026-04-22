import { BufferReader } from "typed-binary";
import type { BinaryParser, ParseOptions, ParseResult, ParsedGroup, ParsedField, ParsedFieldType } from "./types";
import { createProCanonicalSnapshot } from "./pro-canonical";
import { serializePro } from "./pro-serializer";
import type { CritterFieldDef } from "./pro-types";
import {
    ObjectType, ItemSubType, ScenerySubType, DamageType, MaterialType,
    FRMType, BodyType, KillType, ElevatorType, WeaponAnimCode, StatType, ScriptType,
    HeaderFlags, ItemFlagsExt, WallLightFlags, ActionFlags, ContainerFlags, CritterFlags,
    HEADER_SIZE, ITEM_COMMON_SIZE, ITEM_SUBTYPE_OFFSET, ITEM_SUBTYPE_SIZES,
    CRITTER_SIZE, SCENERY_COMMON_SIZE, SCENERY_SUBTYPE_OFFSET, SCENERY_SUBTYPE_SIZES,
    WALL_SIZE, TILE_SIZE, MISC_SIZE,
    CRITTER_PROPERTIES, CRITTER_BASE_PRIMARY, CRITTER_BASE_SECONDARY,
    CRITTER_BASE_DT, CRITTER_BASE_DR, CRITTER_BONUS_PRIMARY, CRITTER_BONUS_SECONDARY,
    CRITTER_BONUS_DT, CRITTER_BONUS_DR, CRITTER_SKILLS,
} from "./pro-types";
import {
    headerSchema, itemCommonSchema, armorSchema, containerSchema, drugSchema,
    weaponSchema, ammoSchema, miscItemSchema, keySchema, critterSchema,
    sceneryCommonSchema, doorSchema, stairsSchema, elevatorSchema, ladderSchema,
    genericScenerySchema, wallSchema, tileSchema, miscSchema,
    type HeaderData, type ItemCommonData, type ArmorData, type ContainerData, type DrugData,
    type WeaponData, type AmmoData, type MiscItemData, type KeyData, type CritterData,
    type SceneryCommonData, type DoorData, type StairsData, type ElevatorData,
    type LadderData, type GenericSceneryData, type WallData, type TileData, type MiscData,
} from "./pro-schemas";

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
    rawValue?: number
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
    errors: string[]
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
    size: number
): ParsedField {
    const flags = parseFlags(value, flagDefs);
    const display = flags.length > 0 ? flags.join(", ") : "(none)";
    return field(name, display, offset, size, "flags", undefined, value);
}

/**
 * Helper to parse Script field into two fields: Script Type and Script ID
 * Format: 0xAABBCCCC where AA=ScriptType, BBCCCC=ScriptID
 * Returns [-1, -1] for 0xFFFFFFFF (no script)
 */
function scriptFields(
    value: number,
    offset: number,
    errors: string[]
): [ParsedField, ParsedField] {
    // -1 (0xFFFFFFFF) means no script
    if (value === 0xFF_FF_FF_FF) {
        return [
            field("Script Type", -1, offset, 1, "int8"),
            field("Script ID", -1, offset + 1, 3, "int24"),
        ];
    }

    const scriptType = (value >> 24) & 0xFF;
    const scriptId = value & 0x00_FF_FF_FF;
    const typeName = ScriptType[scriptType];

    if (typeName === undefined) {
        errors.push(`Invalid Script Type at offset 0x${offset.toString(16)}: ${scriptType}`);
    }

    return [
        enumField("Script Type", scriptType, ScriptType, offset, 1, errors),
        field("Script ID", scriptId, offset + 1, 3, "uint24"),
    ];
}

/**
 * Helper to create a ParsedGroup
 */
function group(
    name: string,
    fields: (ParsedField | ParsedGroup)[],
    expanded = true,
    description?: string
): ParsedGroup {
    return { name, fields, expanded, description };
}

/**
 * Generate fields from data-driven definitions
 */
function fieldsFromDefs(
    defs: CritterFieldDef[],
    data: Record<string, number>,
    errors: string[]
): ParsedField[] {
    return defs.flatMap(([displayName, dataKey, offset, type]) => {
        const value = data[dataKey] ?? 0;
        if (type === "percent") {
            return field(displayName, percent(value), offset, 4, "int32");
        }
        if (type === "script") {
            return scriptFields(value, offset, errors);
        }
        return field(displayName, value, offset, 4, type);
    });
}

/**
 * Parse header into structured format
 */
function parseHeader(data: HeaderData, errors: string[]): ParsedGroup {
    const objectType = (data.objectTypeAndId >> 24) & 0xFF;
    const objectId = data.objectTypeAndId & 0x00FFFFFF;
    const frmType = (data.frmTypeAndId >> 24) & 0xFF;
    const frmId = data.frmTypeAndId & 0x00_ff_ff_ff;

    return group("Header", [
        enumField("Object Type", objectType, ObjectType, 0x00, 1, errors),
        field("Object ID", objectId, 0x01, 3, "uint24"),
        field("Text ID", data.textId, 0x04, 4, "uint32"),
        enumField("FRM Type", frmType, FRMType, 0x08, 1, errors),
        field("FRM ID", frmId, 0x09, 3, "uint24"),
        field("Light Radius", data.lightRadius, 0x0C, 4, "uint32", "0-8 hexes"),
        field("Light Intensity", data.lightIntensity, 0x10, 4, "uint32", "0-65536"),
        flagsField("Flags", data.flags, HeaderFlags, 0x14, 4),
    ]);
}

/**
 * Parse item common fields
 */
function parseItemCommon(data: ItemCommonData, baseOffset: number, errors: string[]): ParsedGroup {
    return group("Item Properties", [
        flagsField("Flags Ext", data.flagsExt, ItemFlagsExt, baseOffset, 3),
        field("Attack Modes", data.attackModes, baseOffset + 3, 1, "uint8"),
        ...scriptFields(data.scriptId, baseOffset + 4, errors),
        enumField("Sub Type", data.subType, ItemSubType, baseOffset + 8, 4, errors),
        enumField("Material", data.materialId, MaterialType, baseOffset + 12, 4, errors),
        field("Size", data.size, baseOffset + 16, 4, "uint32"),
        field("Weight", data.weight, baseOffset + 20, 4, "uint32", "pounds"),
        field("Cost", data.cost, baseOffset + 24, 4, "uint32", "caps"),
        field("Inventory FRM ID", data.inventoryFrmId, baseOffset + 28, 4, "int32"),
        field("Sound ID", data.soundId, baseOffset + 32, 1, "uint8"),
    ]);
}

/**
 * Parse armor subtype
 */
function parseArmor(data: ArmorData, baseOffset: number): ParsedGroup {
    return group("Armor Stats", [
        field("AC", data.ac, baseOffset, 4, "int32"),
        group("Damage Resistance", [
            field("Normal", percent(data.drNormal), baseOffset + 4, 4, "int32"),
            field("Laser", percent(data.drLaser), baseOffset + 8, 4, "int32"),
            field("Fire", percent(data.drFire), baseOffset + 12, 4, "int32"),
            field("Plasma", percent(data.drPlasma), baseOffset + 16, 4, "int32"),
            field("Electrical", percent(data.drElectrical), baseOffset + 20, 4, "int32"),
            field("EMP", percent(data.drEmp), baseOffset + 24, 4, "int32"),
            field("Explosion", percent(data.drExplosion), baseOffset + 28, 4, "int32"),
        ], false),
        group("Damage Threshold", [
            field("Normal", data.dtNormal, baseOffset + 32, 4, "int32"),
            field("Laser", data.dtLaser, baseOffset + 36, 4, "int32"),
            field("Fire", data.dtFire, baseOffset + 40, 4, "int32"),
            field("Plasma", data.dtPlasma, baseOffset + 44, 4, "int32"),
            field("Electrical", data.dtElectrical, baseOffset + 48, 4, "int32"),
            field("EMP", data.dtEmp, baseOffset + 52, 4, "int32"),
            field("Explosion", data.dtExplosion, baseOffset + 56, 4, "int32"),
        ], false),
        field("Perk", data.perk, baseOffset + 60, 4, "int32"),
        field("Male FRM ID", data.maleFrmId, baseOffset + 64, 4, "int32"),
        field("Female FRM ID", data.femaleFrmId, baseOffset + 68, 4, "int32"),
    ]);
}

/**
 * Parse weapon subtype
 */
function parseWeapon(data: WeaponData, baseOffset: number, errors: string[]): ParsedGroup {
    return group("Weapon Stats", [
        enumField("Animation Code", data.animCode, WeaponAnimCode, baseOffset, 4, errors),
        field("Min Damage", data.minDamage, baseOffset + 4, 4, "int32"),
        field("Max Damage", data.maxDamage, baseOffset + 8, 4, "int32"),
        enumField("Damage Type", data.damageType, DamageType, baseOffset + 12, 4, errors),
        field("Max Range 1", data.maxRange1, baseOffset + 16, 4, "int32"),
        field("Max Range 2", data.maxRange2, baseOffset + 20, 4, "int32"),
        field("Projectile PID", data.projectilePid, baseOffset + 24, 4, "int32"),
        field("Min Strength", data.minStrength, baseOffset + 28, 4, "int32"),
        field("AP Cost 1", data.apCost1, baseOffset + 32, 4, "int32"),
        field("AP Cost 2", data.apCost2, baseOffset + 36, 4, "int32"),
        field("Critical Fail", data.criticalFail, baseOffset + 40, 4, "int32"),
        field("Perk", data.perk, baseOffset + 44, 4, "int32"),
        field("Rounds", data.rounds, baseOffset + 48, 4, "int32"),
        field("Caliber", data.caliber, baseOffset + 52, 4, "int32"),
        field("Ammo PID", data.ammoPid, baseOffset + 56, 4, "int32"),
        field("Max Ammo", data.maxAmmo, baseOffset + 60, 4, "int32"),
        field("Sound ID", data.soundId, baseOffset + 64, 1, "uint8"),
    ]);
}

/**
 * Parse ammo subtype
 */
function parseAmmo(data: AmmoData, baseOffset: number): ParsedGroup {
    return group("Ammo Stats", [
        field("Caliber", data.caliber, baseOffset, 4, "int32"),
        field("Quantity", data.quantity, baseOffset + 4, 4, "int32"),
        field("AC Modifier", data.acModifier, baseOffset + 8, 4, "int32"),
        field("DR Modifier", data.drModifier, baseOffset + 12, 4, "int32"),
        field("Damage Multiplier", data.damageMultiplier, baseOffset + 16, 4, "int32"),
        field("Damage Divisor", data.damageDivisor, baseOffset + 20, 4, "int32"),
    ]);
}

/**
 * Parse container subtype
 */
function parseContainer(data: ContainerData, baseOffset: number): ParsedGroup {
    return group("Container Stats", [
        field("Max Size", data.maxSize, baseOffset, 4, "int32"),
        flagsField("Open Flags", data.openFlags, ContainerFlags, baseOffset + 4, 4),
    ]);
}

/**
 * Parse drug subtype
 */
function parseDrug(data: DrugData, baseOffset: number, errors: string[]): ParsedGroup {
    return group("Drug Stats", [
        group("Affected Stats", [
            enumField("Stat 0", data.stat0, StatType, baseOffset, 4, errors),
            enumField("Stat 1", data.stat1, StatType, baseOffset + 4, 4, errors),
            enumField("Stat 2", data.stat2, StatType, baseOffset + 8, 4, errors),
        ]),
        group("Instant Effect", [
            field("Amount 0", data.amount0Instant, baseOffset + 12, 4, "int32"),
            field("Amount 1", data.amount1Instant, baseOffset + 16, 4, "int32"),
            field("Amount 2", data.amount2Instant, baseOffset + 20, 4, "int32"),
        ]),
        group("Delayed Effect 1", [
            field("Duration", data.duration1, baseOffset + 24, 4, "int32"),
            field("Amount 0", data.amount0Delayed1, baseOffset + 28, 4, "int32"),
            field("Amount 1", data.amount1Delayed1, baseOffset + 32, 4, "int32"),
            field("Amount 2", data.amount2Delayed1, baseOffset + 36, 4, "int32"),
        ], false),
        group("Delayed Effect 2", [
            field("Duration", data.duration2, baseOffset + 40, 4, "int32"),
            field("Amount 0", data.amount0Delayed2, baseOffset + 44, 4, "int32"),
            field("Amount 1", data.amount1Delayed2, baseOffset + 48, 4, "int32"),
            field("Amount 2", data.amount2Delayed2, baseOffset + 52, 4, "int32"),
        ], false),
        group("Addiction", [
            field("Rate", percent(data.addictionRate), baseOffset + 56, 4, "int32"),
            field("Effect", data.addictionEffect, baseOffset + 60, 4, "int32"),
            field("Onset", data.addictionOnset, baseOffset + 64, 4, "int32"),
        ]),
    ]);
}

/**
 * Parse misc item subtype
 */
function parseMiscItem(data: MiscItemData, baseOffset: number): ParsedGroup {
    return group("Misc Item Stats", [
        field("Power PID", data.powerPid, baseOffset, 4, "int32"),
        field("Power Type", data.powerType, baseOffset + 4, 4, "int32"),
        field("Charges", data.charges, baseOffset + 8, 4, "int32"),
    ]);
}

/**
 * Parse key subtype
 */
function parseKey(data: KeyData, baseOffset: number): ParsedGroup {
    return group("Key Stats", [
        field("Key Code", `0x${data.keyCode.toString(16).padStart(8, "0")}`, baseOffset, 4, "uint32"),
    ]);
}

/**
 * Parse critter data using data-driven field definitions
 */
function parseCritter(data: CritterData, errors: string[]): ParsedGroup[] {
    // CritterData has known numeric fields - index signature for dynamic access
    const critterData: Record<string, number> = data;

    return [
        group("Critter Properties", [
            field("Flags Ext", `0x${data.flagsExt.toString(16).padStart(8, "0")}`, 0x18, 4, "flags", undefined, data.flagsExt),
            ...fieldsFromDefs(CRITTER_PROPERTIES, critterData, errors),
            flagsField("Critter Flags", data.critterFlags, CritterFlags, 0x2C, 4),
        ]),
        group("Base Primary Stats", fieldsFromDefs(CRITTER_BASE_PRIMARY, critterData, errors)),
        group("Base Secondary Stats", fieldsFromDefs(CRITTER_BASE_SECONDARY, critterData, errors)),
        group("Base Damage Threshold", fieldsFromDefs(CRITTER_BASE_DT, critterData, errors), false),
        group("Base Damage Resistance", fieldsFromDefs(CRITTER_BASE_DR, critterData, errors), false),
        group("Demographics", [
            field("Age", data.age, 0xB4, 4, "int32"),
            field("Gender", data.gender === 0 ? "Male" : "Female", 0xB8, 4, "enum", undefined, data.gender),
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
function parseScenery(
    data: Uint8Array,
    scenery: SceneryCommonData,
    errors: string[]
): ParsedGroup[] {
    const groups: ParsedGroup[] = [];

    groups.push(group("Scenery Properties", [
        flagsField("Wall Light Flags", scenery.wallLightFlags, WallLightFlags, 0x18, 2),
        flagsField("Action Flags", scenery.actionFlags, ActionFlags, 0x1A, 2),
        ...scriptFields(scenery.scriptId, 0x1C, errors),
        enumField("Sub Type", scenery.subType, ScenerySubType, 0x20, 4, errors),
        enumField("Material", scenery.materialId, MaterialType, 0x24, 4, errors),
        field("Sound ID", scenery.soundId, 0x28, 1, "uint8"),
    ]));

    switch (scenery.subType) {
        case 0: { // Door
            const door: DoorData = doorSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            groups.push(group("Door Properties", [
                field("Walk Through", door.walkThruFlag === 0 ? "No" : "Yes", 0x29, 4, "enum"),
                field("Unknown", door.unknown, 0x2D, 4, "uint32"),
            ]));
            break;
        }
        case 1: { // Stairs
            const stairs: StairsData = stairsSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            const destTile = stairs.destTileAndElevation & 0x3FFFFFF;
            const destElev = (stairs.destTileAndElevation >> 26) & 0x3F;
            groups.push(group("Stairs Properties", [
                field("Dest Tile", destTile, 0x29, 4, "uint32"),
                field("Dest Elevation", destElev, 0x29, 4, "uint32"),
                field("Dest Map", stairs.destMap, 0x2D, 4, "uint32"),
            ]));
            break;
        }
        case 2: { // Elevator
            const elevator: ElevatorData = elevatorSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            groups.push(group("Elevator Properties", [
                enumField("Elevator Type", elevator.elevatorType, ElevatorType, 0x29, 4, errors),
                field("Elevator Level", elevator.elevatorLevel, 0x2D, 4, "uint32"),
            ]));
            break;
        }
        case 3: // Ladder Bottom
        case 4: { // Ladder Top
            const ladder: LadderData = ladderSchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            const destTile = ladder.destTileAndElevation & 0x3FFFFFF;
            const destElev = (ladder.destTileAndElevation >> 26) & 0x3F;
            groups.push(group("Ladder Properties", [
                field("Dest Tile", destTile, 0x29, 4, "uint32"),
                field("Dest Elevation", destElev, 0x29, 4, "uint32"),
            ]));
            break;
        }
        case 5: { // Generic
            const genScenery: GenericSceneryData = genericScenerySchema.read(reader(data, SCENERY_SUBTYPE_OFFSET));
            groups.push(group("Generic Properties", [
                field("Unknown", genScenery.unknown, 0x29, 4, "uint32"),
            ]));
            break;
        }
    }

    return groups;
}

/**
 * Parse wall data
 */
function parseWall(data: WallData, errors: string[]): ParsedGroup {
    return group("Wall Properties", [
        flagsField("Wall Light Flags", data.wallLightFlags, WallLightFlags, 0x18, 2),
        flagsField("Action Flags", data.actionFlags, ActionFlags, 0x1A, 2),
        ...scriptFields(data.scriptId, 0x1C, errors),
        enumField("Material", data.materialId, MaterialType, 0x20, 4, errors),
    ]);
}

/**
 * Parse tile data
 */
function parseTile(data: TileData, errors: string[]): ParsedGroup {
    return group("Tile Properties", [
        enumField("Material", data.materialId, MaterialType, 0x18, 4, errors),
    ]);
}

/**
 * Parse misc data
 */
function parseMisc(data: MiscData): ParsedGroup {
    return group("Misc Properties", [
        field("Unknown", data.unknown, 0x18, 4, "uint32"),
    ]);
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
        const objectType = (header.objectTypeAndId >> 24) & 0xFF;

        // Validate file size based on object type
        let expectedSize: number;
        let subType: number | undefined;

        switch (objectType) {
            case 0: { // Item
                if (fileSize < HEADER_SIZE + ITEM_COMMON_SIZE) {
                    return this.fail(`Item file too small: ${fileSize} bytes, need at least ${HEADER_SIZE + ITEM_COMMON_SIZE}`);
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
            case 2: { // Scenery
                if (fileSize < HEADER_SIZE + SCENERY_COMMON_SIZE) {
                    return this.fail(`Scenery file too small: ${fileSize} bytes, need at least ${HEADER_SIZE + SCENERY_COMMON_SIZE}`);
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
        const headerGroup = parseHeader(header, errors);
        const groups: (ParsedField | ParsedGroup)[] = [headerGroup];

        switch (objectType) {
            case 0: { // Item
                const itemCommon: ItemCommonData = itemCommonSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseItemCommon(itemCommon, HEADER_SIZE, errors));

                switch (itemCommon.subType) {
                    case 0: // Armor
                        groups.push(parseArmor(armorSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    case 1: // Container
                        groups.push(parseContainer(containerSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    case 2: // Drug
                        groups.push(parseDrug(drugSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET, errors));
                        break;
                    case 3: // Weapon
                        groups.push(parseWeapon(weaponSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET, errors));
                        break;
                    case 4: // Ammo
                        groups.push(parseAmmo(ammoSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    case 5: // Misc
                        groups.push(parseMiscItem(miscItemSchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    case 6: // Key
                        groups.push(parseKey(keySchema.read(reader(data, ITEM_SUBTYPE_OFFSET)), ITEM_SUBTYPE_OFFSET));
                        break;
                    default:
                        return this.fail(`Unknown item subtype: ${itemCommon.subType}`);
                }
                break;
            }
            case 1: { // Critter
                const critter: CritterData = critterSchema.read(reader(data, HEADER_SIZE));
                groups.push(...parseCritter(critter, errors));
                break;
            }
            case 2: { // Scenery
                const scenery: SceneryCommonData = sceneryCommonSchema.read(reader(data, HEADER_SIZE));
                groups.push(...parseScenery(data, scenery, errors));
                break;
            }
            case 3: { // Wall
                const wall: WallData = wallSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseWall(wall, errors));
                break;
            }
            case 4: { // Tile
                const tile: TileData = tileSchema.read(reader(data, HEADER_SIZE));
                groups.push(parseTile(tile, errors));
                break;
            }
            case 5: { // Misc
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
