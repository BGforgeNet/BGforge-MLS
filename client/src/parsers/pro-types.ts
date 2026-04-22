/**
 * PRO file format type definitions and lookup tables
 */

// Object types
export const ObjectType: Record<number, string> = {
    0: "Item",
    1: "Critter",
    2: "Scenery",
    3: "Wall",
    4: "Tile",
    5: "Misc",
};

// Item subtypes
export const ItemSubType: Record<number, string> = {
    0: "Armor",
    1: "Container",
    2: "Drug",
    3: "Weapon",
    4: "Ammo",
    5: "Misc Item",
    6: "Key",
};

// Scenery subtypes
export const ScenerySubType: Record<number, string> = {
    0: "Door",
    1: "Stairs",
    2: "Elevator",
    3: "Ladder Bottom",
    4: "Ladder Top",
    5: "Generic",
};

// Damage types
export const DamageType: Record<number, string> = {
    0: "Normal",
    1: "Laser",
    2: "Fire",
    3: "Plasma",
    4: "Electrical",
    5: "EMP",
    6: "Explosive",
};

// Material types
export const MaterialType: Record<number, string> = {
    0: "Glass",
    1: "Metal",
    2: "Plastic",
    3: "Wood",
    4: "Dirt",
    5: "Stone",
    6: "Cement",
    7: "Leather",
};

// FRM types
export const FRMType: Record<number, string> = {
    0: "Items",
    1: "Critters",
    2: "Scenery",
    3: "Walls",
    4: "Tiles",
    5: "Background",
    6: "Interface",
    7: "Inventory",
};

// Body types (critter)
export const BodyType: Record<number, string> = {
    0: "Biped",
    1: "Quadruped",
    2: "Robotic",
};

// Kill types (critter) - 0x00-0x12
export const KillType: Record<number, string> = {
    0: "Men",
    1: "Women",
    2: "Children",
    3: "Super Mutants",
    4: "Ghouls",
    5: "Brahmin",
    6: "Radscorpions",
    7: "Rats",
    8: "Floaters",
    9: "Centaurs",
    10: "Robots",
    11: "Dogs",
    12: "Manti",
    13: "Deathclaws",
    14: "Plants",
    15: "Geckos",
    16: "Aliens",
    17: "Giant Ants",
    18: "Big Bad Boss",
};

// Elevator types - 0x00-0x17
export const ElevatorType: Record<number, string> = {
    0: "Elevator 0",
    1: "Elevator 1",
    2: "Elevator 2",
    3: "Elevator 3",
    4: "Elevator 4",
    5: "Elevator 5",
    6: "Elevator 6",
    7: "Elevator 7",
    8: "Elevator 8",
    9: "Elevator 9",
    10: "Elevator 10",
    11: "Elevator 11",
    12: "Elevator 12",
    13: "Elevator 13",
    14: "Elevator 14",
    15: "Elevator 15",
    16: "Elevator 16",
    17: "Elevator 17",
    18: "Elevator 18",
    19: "Elevator 19",
    20: "Elevator 20",
    21: "Elevator 21",
    22: "Elevator 22",
    23: "Elevator 23",
};

// Weapon animation codes - 0x00-0x0F
export const WeaponAnimCode: Record<number, string> = {
    0: "None",
    1: "Knife",
    2: "Club",
    3: "Sledgehammer",
    4: "Spear",
    5: "Pistol",
    6: "SMG",
    7: "Rifle",
    8: "Big Gun",
    9: "Minigun",
    10: "Rocket Launcher",
    11: "Sfall 11",
    12: "Sfall 12",
    13: "Sfall 13",
    14: "Sfall 14",
    15: "Sfall 15",
};

// Stats (for drugs) - includes -2 (random) and -1 (none)
export const StatType: Record<number, string> = {
    [-2]: "Random",
    [-1]: "None",
    0: "Strength",
    1: "Perception",
    2: "Endurance",
    3: "Charisma",
    4: "Intelligence",
    5: "Agility",
    6: "Luck",
    7: "Max HP",
    8: "Max AP",
    9: "AC",
    10: "Unused",
    11: "Melee Damage",
    12: "Carry Weight",
    13: "Sequence",
    14: "Healing Rate",
    15: "Critical Chance",
    16: "Better Criticals",
    17: "DT Normal",
    18: "DT Laser",
    19: "DT Fire",
    20: "DT Plasma",
    21: "DT Electrical",
    22: "DT EMP",
    23: "DT Explosion",
    24: "DR Normal",
    25: "DR Laser",
    26: "DR Fire",
    27: "DR Plasma",
    28: "DR Electrical",
    29: "DR EMP",
    30: "DR Explosion",
    31: "Radiation Resist",
    32: "Poison Resist",
    33: "Age",
    34: "Gender",
    35: "Current HP",
    36: "Current Poison",
    37: "Current Rad",
};

// Flag definitions
export const HeaderFlags: Record<number, string> = {
    0x00_00_00_08: "Flat",
    0x00_00_00_10: "NoBlock",
    0x00_00_08_00: "MultiHex",
    0x00_00_10_00: "NoHighlight",
    0x00_00_40_00: "TransRed",
    0x00_00_80_00: "TransNone",
    0x00_01_00_00: "TransWall",
    0x00_02_00_00: "TransGlass",
    0x00_04_00_00: "TransSteam",
    0x00_08_00_00: "TransEnergy",
    0x10_00_00_00: "WallTransEnd",
    0x20_00_00_00: "LightThru",
    0x80_00_00_00: "ShootThru",
};

export const ItemFlagsExt: Record<number, string> = {
    0x00_00_01: "BigGun",
    0x00_00_02: "2Hnd",
    0x00_00_08: "Use",
    0x00_00_10: "UseOnSmth",
    0x00_00_20: "Look",
    0x00_00_80: "PickUp",
    0x08_00_00: "Hidden",
};

export const WallLightFlags: Record<number, string> = {
    0x00_00: "North/South",
    0x08_00: "East/West",
    0x10_00: "NorthCorner",
    0x20_00: "SouthCorner",
    0x40_00: "EastCorner",
    0x80_00: "WestCorner",
};

export const ActionFlags: Record<number, string> = {
    0x00_01: "Kneel",
    0x00_08: "Use",
    0x00_10: "UseOnSmth",
    0x00_20: "Look",
    0x00_40: "Talk",
    0x00_80: "PickUp",
};

export const ContainerFlags: Record<number, string> = {
    0x00_00_00_01: "CannotPickUp",
    0x00_00_00_08: "MagicHandsGrnd",
};

export const CritterFlags: Record<number, string> = {
    0x00_00_00_02: "Barter",
    0x00_00_00_20: "NoSteal",
    0x00_00_00_40: "NoDrop",
    0x00_00_00_80: "NoLimbs",
    0x00_00_01_00: "NoAges",
    0x00_00_02_00: "NoHeal",
    0x00_00_04_00: "Invulnerable",
    0x00_00_08_00: "NoFlatten",
    0x00_00_10_00: "SpecialDeath",
    0x00_00_20_00: "RangeMelee",
    0x00_00_40_00: "NoKnock",
};

// Script types (upper byte of Script ID field)
export const ScriptType: Record<number, string> = {
    0: "System",
    1: "Spatial",
    2: "Timer",
    3: "Item",
    4: "Critter",
};

// Size constants
export const HEADER_SIZE = 0x18; // 24 bytes
export const ITEM_COMMON_SIZE = 0x21; // 33 bytes (0x18-0x38 inclusive)
export const ITEM_SUBTYPE_OFFSET = HEADER_SIZE + ITEM_COMMON_SIZE; // 0x39
export const ITEM_SUBTYPE_SIZES: Record<number, number> = {
    0: 72,  // Armor
    1: 8,   // Container
    2: 68,  // Drug
    3: 65,  // Weapon
    4: 24,  // Ammo
    5: 12,  // Misc Item
    6: 4,   // Key
};
export const CRITTER_SIZE = 0x1A0; // 416 bytes
export const SCENERY_COMMON_SIZE = 0x11; // 17 bytes (0x18-0x28 inclusive)
export const SCENERY_SUBTYPE_OFFSET = HEADER_SIZE + SCENERY_COMMON_SIZE; // 0x29
export const SCENERY_SUBTYPE_SIZES: Record<number, number> = {
    0: 8,  // Door
    1: 8,  // Stairs
    2: 8,  // Elevator
    3: 4,  // Ladder Bottom
    4: 4,  // Ladder Top
    5: 4,  // Generic (unknown field)
};
export const WALL_SIZE = 0x24; // 36 bytes
export const TILE_SIZE = 0x1C; // 28 bytes
export const MISC_SIZE = 0x1C; // 28 bytes

// Critter field definitions for data-driven parsing
// [displayName, dataKey, offset, type, group?]
export type CritterFieldDef = [string, string, number, "int32" | "uint32" | "percent" | "script"];

export const CRITTER_PROPERTIES: CritterFieldDef[] = [
    ["Script ID", "scriptId", 0x1C, "script"],
    ["Head FRM ID", "headFrmId", 0x20, "int32"],
    ["AI Packet", "aiPacket", 0x24, "uint32"],
    ["Team Number", "teamNumber", 0x28, "uint32"],
];

export const CRITTER_BASE_PRIMARY: CritterFieldDef[] = [
    ["Strength", "strength", 0x30, "int32"],
    ["Perception", "perception", 0x34, "int32"],
    ["Endurance", "endurance", 0x38, "int32"],
    ["Charisma", "charisma", 0x3C, "int32"],
    ["Intelligence", "intelligence", 0x40, "int32"],
    ["Agility", "agility", 0x44, "int32"],
    ["Luck", "luck", 0x48, "int32"],
];

export const CRITTER_BASE_SECONDARY: CritterFieldDef[] = [
    ["Hit Points", "hitPoints", 0x4C, "int32"],
    ["Action Points", "actionPoints", 0x50, "int32"],
    ["Armor Class", "armorClass", 0x54, "int32"],
    ["Unarmed Damage", "unarmedDamage", 0x58, "int32"],
    ["Melee Damage", "meleeDamage", 0x5C, "int32"],
    ["Carry Weight", "carryWeight", 0x60, "int32"],
    ["Sequence", "sequence", 0x64, "int32"],
    ["Healing Rate", "healingRate", 0x68, "int32"],
    ["Critical Chance", "criticalChance", 0x6C, "int32"],
    ["Better Criticals", "betterCriticals", 0x70, "int32"],
];

export const CRITTER_BASE_DT: CritterFieldDef[] = [
    ["Normal", "dtNormal", 0x74, "int32"],
    ["Laser", "dtLaser", 0x78, "int32"],
    ["Fire", "dtFire", 0x7C, "int32"],
    ["Plasma", "dtPlasma", 0x80, "int32"],
    ["Electrical", "dtElectrical", 0x84, "int32"],
    ["EMP", "dtEmp", 0x88, "int32"],
    ["Explosive", "dtExplosive", 0x8C, "int32"],
];

export const CRITTER_BASE_DR: CritterFieldDef[] = [
    ["Normal", "drNormal", 0x90, "percent"],
    ["Laser", "drLaser", 0x94, "percent"],
    ["Fire", "drFire", 0x98, "percent"],
    ["Plasma", "drPlasma", 0x9C, "percent"],
    ["Electrical", "drElectrical", 0xA0, "percent"],
    ["EMP", "drEmp", 0xA4, "percent"],
    ["Explosive", "drExplosive", 0xA8, "percent"],
    ["Radiation", "drRadiation", 0xAC, "percent"],
    ["Poison", "drPoison", 0xB0, "percent"],
];

export const CRITTER_BONUS_PRIMARY: CritterFieldDef[] = [
    ["Strength", "strengthBonus", 0xBC, "int32"],
    ["Perception", "perceptionBonus", 0xC0, "int32"],
    ["Endurance", "enduranceBonus", 0xC4, "int32"],
    ["Charisma", "charismaBonus", 0xC8, "int32"],
    ["Intelligence", "intelligenceBonus", 0xCC, "int32"],
    ["Agility", "agilityBonus", 0xD0, "int32"],
    ["Luck", "luckBonus", 0xD4, "int32"],
];

export const CRITTER_BONUS_SECONDARY: CritterFieldDef[] = [
    ["Hit Points", "hitPointsBonus", 0xD8, "int32"],
    ["Action Points", "actionPointsBonus", 0xDC, "int32"],
    ["Armor Class", "armorClassBonus", 0xE0, "int32"],
    ["Unarmed Damage", "unarmedDamageBonus", 0xE4, "int32"],
    ["Melee Damage", "meleeDamageBonus", 0xE8, "int32"],
    ["Carry Weight", "carryWeightBonus", 0xEC, "int32"],
    ["Sequence", "sequenceBonus", 0xF0, "int32"],
    ["Healing Rate", "healingRateBonus", 0xF4, "int32"],
    ["Critical Chance", "criticalChanceBonus", 0xF8, "int32"],
    ["Better Criticals", "betterCriticalsBonus", 0xFC, "int32"],
];

export const CRITTER_BONUS_DT: CritterFieldDef[] = [
    ["Normal", "dtNormalBonus", 0x1_00, "int32"],
    ["Laser", "dtLaserBonus", 0x1_04, "int32"],
    ["Fire", "dtFireBonus", 0x1_08, "int32"],
    ["Plasma", "dtPlasmaBonus", 0x10C, "int32"],
    ["Electrical", "dtElectricalBonus", 0x1_10, "int32"],
    ["EMP", "dtEmpBonus", 0x1_14, "int32"],
    ["Explosive", "dtExplosiveBonus", 0x1_18, "int32"],
];

export const CRITTER_BONUS_DR: CritterFieldDef[] = [
    ["Normal", "drNormalBonus", 0x1_1c, "int32"],
    ["Laser", "drLaserBonus", 0x1_20, "int32"],
    ["Fire", "drFireBonus", 0x1_24, "int32"],
    ["Plasma", "drPlasmaBonus", 0x1_28, "int32"],
    ["Electrical", "drElectricalBonus", 0x12C, "int32"],
    ["EMP", "drEmpBonus", 0x1_30, "int32"],
    ["Explosive", "drExplosiveBonus", 0x1_34, "int32"],
    ["Radiation", "drRadiationBonus", 0x1_38, "int32"],
    ["Poison", "drPoisonBonus", 0x13C, "int32"],
];

export const CRITTER_SKILLS: CritterFieldDef[] = [
    ["Small Guns", "skillSmallGuns", 0x1_48, "int32"],
    ["Big Guns", "skillBigGuns", 0x14C, "int32"],
    ["Energy Weapons", "skillEnergyWeapons", 0x1_50, "int32"],
    ["Unarmed", "skillUnarmed", 0x1_54, "int32"],
    ["Melee", "skillMelee", 0x1_58, "int32"],
    ["Throwing", "skillThrowing", 0x15C, "int32"],
    ["First Aid", "skillFirstAid", 0x1_60, "int32"],
    ["Doctor", "skillDoctor", 0x1_64, "int32"],
    ["Sneak", "skillSneak", 0x1_68, "int32"],
    ["Lockpick", "skillLockpick", 0x16C, "int32"],
    ["Steal", "skillSteal", 0x1_70, "int32"],
    ["Traps", "skillTraps", 0x1_74, "int32"],
    ["Science", "skillScience", 0x1_78, "int32"],
    ["Repair", "skillRepair", 0x17C, "int32"],
    ["Speech", "skillSpeech", 0x1_80, "int32"],
    ["Barter", "skillBarter", 0x1_84, "int32"],
    ["Gambling", "skillGambling", 0x1_88, "int32"],
    ["Outdoorsman", "skillOutdoorsman", 0x18C, "int32"],
];
