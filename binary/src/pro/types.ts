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
// Material 0..7 plus the -1 "no proto default" sentinel emitted by the
// engine's proto_scenery_init (proto.cc:956). Item, wall, and tile protos
// initialise material to 1 (Metal), so -1 is observed primarily on scenery in
// vanilla; modded data may set it elsewhere, hence sentinel handling on every
// material field that uses this lookup.
export const MaterialType: Record<number, string> = {
    [-1]: "None",
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

// Elevator types - 0x00-0x17 plus the -1 "no proto default" sentinel
// emitted by the engine's proto_scenery_subdata_init (proto.cc:976). The
// per-object map record always supplies the live value at runtime; for
// script-spawned elevators (rare) the proto value is the seed, and -1 there
// signals "no default — caller must set it" (scripts.cc:1152 bails on -1).
export const ElevatorType: Record<number, string> = {
    [-1]: "None",
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
    0x00000008: "Flat",
    0x00000010: "NoBlock",
    0x00000800: "MultiHex",
    0x00001000: "NoHighlight",
    0x00004000: "TransRed",
    0x00008000: "TransNone",
    0x00010000: "TransWall",
    0x00020000: "TransGlass",
    0x00040000: "TransSteam",
    0x00080000: "TransEnergy",
    0x10000000: "WallTransEnd",
    0x20000000: "LightThru",
    0x80000000: "ShootThru",
};

export const ItemFlagsExt: Record<number, string> = {
    0x000001: "BigGun",
    0x000002: "TwoHand",
    0x000008: "Use",
    0x000010: "UseOnSmth",
    0x000020: "Look",
    0x000080: "PickUp",
    0x080000: "Hidden",
};

export const WallLightFlags: Record<number, string> = {
    0x0000: "North/South",
    0x0800: "East/West",
    0x1000: "NorthCorner",
    0x2000: "SouthCorner",
    0x4000: "EastCorner",
    0x8000: "WestCorner",
};

export const ActionFlags: Record<number, string> = {
    0x0001: "Kneel",
    0x0008: "Use",
    0x0010: "UseOnSmth",
    0x0020: "Look",
    0x0040: "Talk",
    0x0080: "PickUp",
};

export const ContainerFlags: Record<number, string> = {
    0x00000001: "CannotPickUp",
    0x00000008: "MagicHandsGrnd",
};

export const CritterFlags: Record<number, string> = {
    0x00000002: "Barter",
    0x00000020: "NoSteal",
    0x00000040: "NoDrop",
    0x00000080: "NoLimbs",
    0x00000100: "NoAges",
    0x00000200: "NoHeal",
    0x00000400: "Invulnerable",
    0x00000800: "NoFlatten",
    0x00001000: "SpecialDeath",
    0x00002000: "RangeMelee",
    0x00004000: "NoKnock",
};

// Script types (upper byte of Script ID field)
export const ScriptType: Record<number, string> = {
    [-1]: "(none)",
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
    0: 72, // Armor
    1: 8, // Container
    2: 68, // Drug
    3: 65, // Weapon
    4: 24, // Ammo
    5: 12, // Misc Item
    6: 4, // Key
};
export const CRITTER_SIZE = 0x1a0; // 416 bytes
export const SCENERY_COMMON_SIZE = 0x11; // 17 bytes (0x18-0x28 inclusive)
export const SCENERY_SUBTYPE_OFFSET = HEADER_SIZE + SCENERY_COMMON_SIZE; // 0x29
export const SCENERY_SUBTYPE_SIZES: Record<number, number> = {
    0: 8, // Door
    1: 8, // Stairs
    2: 8, // Elevator
    3: 4, // Ladder Bottom
    4: 4, // Ladder Top
    5: 4, // Generic (unknown field)
};
export const WALL_SIZE = 0x24; // 36 bytes
export const TILE_SIZE = 0x1c; // 28 bytes
export const MISC_SIZE = 0x1c; // 28 bytes

// Critter field definitions for data-driven parsing
// [displayName, dataKey, offset, type, group?]
export type CritterFieldDef = [string, string, number, "int32" | "uint32" | "percent" | "scriptType" | "scriptId"];

export const CRITTER_PROPERTIES: CritterFieldDef[] = [
    ["Script Type", "scriptType", 0x1c, "scriptType"],
    ["Script ID", "scriptId", 0x1d, "scriptId"],
    ["Head FRM ID", "headFrmId", 0x20, "int32"],
    ["AI Packet", "aiPacket", 0x24, "uint32"],
    ["Team Number", "teamNumber", 0x28, "uint32"],
];

export const CRITTER_BASE_PRIMARY: CritterFieldDef[] = [
    ["Strength", "strength", 0x30, "int32"],
    ["Perception", "perception", 0x34, "int32"],
    ["Endurance", "endurance", 0x38, "int32"],
    ["Charisma", "charisma", 0x3c, "int32"],
    ["Intelligence", "intelligence", 0x40, "int32"],
    ["Agility", "agility", 0x44, "int32"],
    ["Luck", "luck", 0x48, "int32"],
];

export const CRITTER_BASE_SECONDARY: CritterFieldDef[] = [
    ["Hit Points", "hitPoints", 0x4c, "int32"],
    ["Action Points", "actionPoints", 0x50, "int32"],
    ["Armor Class", "armorClass", 0x54, "int32"],
    ["Unarmed Damage", "unarmedDamage", 0x58, "int32"],
    ["Melee Damage", "meleeDamage", 0x5c, "int32"],
    ["Carry Weight", "carryWeight", 0x60, "int32"],
    ["Sequence", "sequence", 0x64, "int32"],
    ["Healing Rate", "healingRate", 0x68, "int32"],
    ["Critical Chance", "criticalChance", 0x6c, "int32"],
    ["Better Criticals", "betterCriticals", 0x70, "int32"],
];

export const CRITTER_BASE_DT: CritterFieldDef[] = [
    ["Normal", "dtNormal", 0x74, "int32"],
    ["Laser", "dtLaser", 0x78, "int32"],
    ["Fire", "dtFire", 0x7c, "int32"],
    ["Plasma", "dtPlasma", 0x80, "int32"],
    ["Electrical", "dtElectrical", 0x84, "int32"],
    ["EMP", "dtEmp", 0x88, "int32"],
    ["Explosive", "dtExplosive", 0x8c, "int32"],
];

export const CRITTER_BASE_DR: CritterFieldDef[] = [
    ["Normal", "drNormal", 0x90, "percent"],
    ["Laser", "drLaser", 0x94, "percent"],
    ["Fire", "drFire", 0x98, "percent"],
    ["Plasma", "drPlasma", 0x9c, "percent"],
    ["Electrical", "drElectrical", 0xa0, "percent"],
    ["EMP", "drEmp", 0xa4, "percent"],
    ["Explosive", "drExplosive", 0xa8, "percent"],
    ["Radiation", "drRadiation", 0xac, "percent"],
    ["Poison", "drPoison", 0xb0, "percent"],
];

export const CRITTER_BONUS_PRIMARY: CritterFieldDef[] = [
    ["Strength", "strengthBonus", 0xbc, "int32"],
    ["Perception", "perceptionBonus", 0xc0, "int32"],
    ["Endurance", "enduranceBonus", 0xc4, "int32"],
    ["Charisma", "charismaBonus", 0xc8, "int32"],
    ["Intelligence", "intelligenceBonus", 0xcc, "int32"],
    ["Agility", "agilityBonus", 0xd0, "int32"],
    ["Luck", "luckBonus", 0xd4, "int32"],
];

export const CRITTER_BONUS_SECONDARY: CritterFieldDef[] = [
    ["Hit Points", "hitPointsBonus", 0xd8, "int32"],
    ["Action Points", "actionPointsBonus", 0xdc, "int32"],
    ["Armor Class", "armorClassBonus", 0xe0, "int32"],
    ["Unarmed Damage", "unarmedDamageBonus", 0xe4, "int32"],
    ["Melee Damage", "meleeDamageBonus", 0xe8, "int32"],
    ["Carry Weight", "carryWeightBonus", 0xec, "int32"],
    ["Sequence", "sequenceBonus", 0xf0, "int32"],
    ["Healing Rate", "healingRateBonus", 0xf4, "int32"],
    ["Critical Chance", "criticalChanceBonus", 0xf8, "int32"],
    ["Better Criticals", "betterCriticalsBonus", 0xfc, "int32"],
];

export const CRITTER_BONUS_DT: CritterFieldDef[] = [
    ["Normal", "dtNormalBonus", 0x100, "int32"],
    ["Laser", "dtLaserBonus", 0x104, "int32"],
    ["Fire", "dtFireBonus", 0x108, "int32"],
    ["Plasma", "dtPlasmaBonus", 0x10c, "int32"],
    ["Electrical", "dtElectricalBonus", 0x110, "int32"],
    ["EMP", "dtEmpBonus", 0x114, "int32"],
    ["Explosive", "dtExplosiveBonus", 0x118, "int32"],
];

export const CRITTER_BONUS_DR: CritterFieldDef[] = [
    ["Normal", "drNormalBonus", 0x11c, "int32"],
    ["Laser", "drLaserBonus", 0x120, "int32"],
    ["Fire", "drFireBonus", 0x124, "int32"],
    ["Plasma", "drPlasmaBonus", 0x128, "int32"],
    ["Electrical", "drElectricalBonus", 0x12c, "int32"],
    ["EMP", "drEmpBonus", 0x130, "int32"],
    ["Explosive", "drExplosiveBonus", 0x134, "int32"],
    ["Radiation", "drRadiationBonus", 0x138, "int32"],
    ["Poison", "drPoisonBonus", 0x13c, "int32"],
];

export const CRITTER_SKILLS: CritterFieldDef[] = [
    ["Small Guns", "skillSmallGuns", 0x148, "int32"],
    ["Big Guns", "skillBigGuns", 0x14c, "int32"],
    ["Energy Weapons", "skillEnergyWeapons", 0x150, "int32"],
    ["Unarmed", "skillUnarmed", 0x154, "int32"],
    ["Melee", "skillMelee", 0x158, "int32"],
    ["Throwing", "skillThrowing", 0x15c, "int32"],
    ["First Aid", "skillFirstAid", 0x160, "int32"],
    ["Doctor", "skillDoctor", 0x164, "int32"],
    ["Sneak", "skillSneak", 0x168, "int32"],
    ["Lockpick", "skillLockpick", 0x16c, "int32"],
    ["Steal", "skillSteal", 0x170, "int32"],
    ["Traps", "skillTraps", 0x174, "int32"],
    ["Science", "skillScience", 0x178, "int32"],
    ["Repair", "skillRepair", 0x17c, "int32"],
    ["Speech", "skillSpeech", 0x180, "int32"],
    ["Barter", "skillBarter", 0x184, "int32"],
    ["Gambling", "skillGambling", 0x188, "int32"],
    ["Outdoorsman", "skillOutdoorsman", 0x18c, "int32"],
];
