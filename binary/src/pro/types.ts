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
// signals "no default - caller must set it" (scripts.cc:1152 bails on -1).
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

// Weapon ammo caliber - values 0x00-0x12 (CALIBER_TYPE_NONE..CALIBER_TYPE_7_62). Names and ordering
// cross-checked against fallout2-ce `proto_types.h` (CALIBER_TYPE_* enum, COUNT = 19).
export const Caliber: Record<number, string> = {
    0: "None",
    1: "Rocket",
    2: "Flamethrower Fuel",
    3: "C Energy Cell",
    4: "D Energy Cell",
    5: ".223",
    6: "5mm",
    7: ".40 cal",
    8: "10mm",
    9: ".44 cal",
    10: "14mm",
    11: "12 gauge",
    12: "9mm",
    13: "BB",
    14: ".45 cal",
    15: "2mm",
    16: "4.7mm Caseless",
    17: "NH Needler",
    18: "7.62",
};

// Item attack-mode subtype - the per-nibble value of the item-common "Attack modes" byte (primary in the low
// nibble, secondary in the high nibble). Names and 0-8 ordering are from fallout2-ce `item.cc` `_attack_subtype`
// (cross-checked against sfall `EngineUtils.cpp` `weapon_types`). 4-bit field, so values 9-15 are unused.
export const AttackSubType: Record<number, string> = {
    0: "None",
    1: "Punch",
    2: "Kick",
    3: "Swing",
    4: "Thrust",
    5: "Throw",
    6: "Single",
    7: "Burst",
    8: "Continuous",
};

// Perk granted by a weapon or armor (proto `perk` field; -1 = none). Names and 0..118 ordering are from
// fallout2-ce `perk_defs.h` (the `Perk` enum); labels are humanized from the enum tokens. Open: sfall registers
// extra "fake perks" beyond the engine's 119 (`Modules/Perks.cpp`), so callers mark the field `enumOpen`.
export const Perk: Record<number, string> = {
    [-1]: "None",
    0: "Awareness",
    1: "Bonus HtH Attacks",
    2: "Bonus HtH Damage",
    3: "Bonus Move",
    4: "Bonus Ranged Damage",
    5: "Bonus Rate of Fire",
    6: "Earlier Sequence",
    7: "Faster Healing",
    8: "More Criticals",
    9: "Night Vision",
    10: "Presence",
    11: "Rad Resistance",
    12: "Toughness",
    13: "Strong Back",
    14: "Sharpshooter",
    15: "Silent Running",
    16: "Survivalist",
    17: "Master Trader",
    18: "Educated",
    19: "Healer",
    20: "Fortune Finder",
    21: "Better Criticals",
    22: "Empathy",
    23: "Slayer",
    24: "Sniper",
    25: "Silent Death",
    26: "Action Boy",
    27: "Mental Block",
    28: "Lifegiver",
    29: "Dodger",
    30: "Snakeater",
    31: "Mr Fixit",
    32: "Medic",
    33: "Master Thief",
    34: "Speaker",
    35: "Heave Ho",
    36: "Friendly Foe",
    37: "Pickpocket",
    38: "Ghost",
    39: "Cult of Personality",
    40: "Scrounger",
    41: "Explorer",
    42: "Flower Child",
    43: "Pathfinder",
    44: "Animal Friend",
    45: "Scout",
    46: "Mysterious Stranger",
    47: "Ranger",
    48: "Quick Pockets",
    49: "Smooth Talker",
    50: "Swift Learner",
    51: "Tag",
    52: "Mutate",
    53: "Nuka Cola Addiction",
    54: "Buffout Addiction",
    55: "Mentats Addiction",
    56: "Psycho Addiction",
    57: "Radaway Addiction",
    58: "Weapon Long Range",
    59: "Weapon Accurate",
    60: "Weapon Penetrate",
    61: "Weapon Knockback",
    62: "Powered Armor",
    63: "Combat Armor",
    64: "Weapon Scope Range",
    65: "Weapon Fast Reload",
    66: "Weapon Night Sight",
    67: "Weapon Flameboy",
    68: "Armor Advanced I",
    69: "Armor Advanced II",
    70: "Jet Addiction",
    71: "Tragic Addiction",
    72: "Armor Charisma",
    73: "Gecko Skinning",
    74: "Dermal Impact Armor",
    75: "Dermal Impact Assault Enhancement",
    76: "Phoenix Armor Implants",
    77: "Phoenix Assault Enhancement",
    78: "Vault City Inoculations",
    79: "Adrenaline Rush",
    80: "Cautious Nature",
    81: "Comprehension",
    82: "Demolition Expert",
    83: "Gambler",
    84: "Gain Strength",
    85: "Gain Perception",
    86: "Gain Endurance",
    87: "Gain Charisma",
    88: "Gain Intelligence",
    89: "Gain Agility",
    90: "Gain Luck",
    91: "Harmless",
    92: "Here and Now",
    93: "HtH Evade",
    94: "Kama Sutra Master",
    95: "Karma Beacon",
    96: "Light Step",
    97: "Living Anatomy",
    98: "Magnetic Personality",
    99: "Negotiator",
    100: "Pack Rat",
    101: "Pyromaniac",
    102: "Quick Recovery",
    103: "Salesman",
    104: "Stonewall",
    105: "Thief",
    106: "Weapon Handling",
    107: "Vault City Training",
    108: "Alcohol Raised Hit Points",
    109: "Alcohol Raised Hit Points II",
    110: "Alcohol Lowered Hit Points",
    111: "Alcohol Lowered Hit Points II",
    112: "Autodoc Raised Hit Points",
    113: "Autodoc Raised Hit Points II",
    114: "Autodoc Lowered Hit Points",
    115: "Autodoc Lowered Hit Points II",
    116: "Expert Excrement Expeditor",
    117: "Weapon Enhanced Knockout",
    118: "Jinxed",
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

// Flag definitions.
//
// The CamelCase flag names here (NoBlock, MultiHex, TransRed, ShootThru, BigGun, ...) are kept verbatim and
// deliberately NOT humanized to "No Block" / "Multi Hex": these are the canonical token names the Fallout proto
// format and the modding community use, so they are more recognizable to the user as-is. This is the opposite
// call from the Infinity Engine MAP flags, whose CamelCase keys (SkipElevation0Tiles) are internal and humanize
// far better - those carry a presentation-layer `labels` override; these intentionally do not.
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

/**
 * Critter proto `flagsExt` (the proto "Flags Ext" / `extendedFlags` action-flag bitfield - distinct from the
 * common object `flags` and the critter behavior `critterFlags`). Only two bits are defined for critters; the
 * values are cross-checked against fallout2-ce `ItemProtoExtendedFlags` (`PROTO_EXT_FLAG_LOOK` /
 * `_CAN_TALK_TO`) and the falloutmods PRO_File_Format wiki.
 */
export const CritterFlagsExt: Record<number, string> = {
    0x00002000: "Look",
    0x00004000: "Can talk to",
};

// Critter gender (demographics)
export const Gender: Record<number, string> = {
    0: "Male",
    1: "Female",
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
