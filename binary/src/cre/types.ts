/**
 * CRE v1 wire constants and CRE-specific enum / flag lookup tables.
 *
 * CRE has six wire chunks: a fixed 0x2D4 header, four variable-length tables
 * pointed at by header offset/count pairs (known spells, spell-memorisation
 * info, memorised spells, items), an effects table whose record size depends
 * on the header's `effStructureVersion` byte (EFF v1 = 0x30, EFF v2 body =
 * 0x108), and a fixed 80-byte item-slot block.
 *
 * The header lookup tables here cover BG1 / BG2 / BGEE shape only; the
 * PSTEE-specific reinterpretation of offsets 0x0084-0x009A is out of scope
 * for this format adapter (the byte ranges still round-trip; their semantic
 * labels just stay generic).
 */

/**
 * Display-group labels emitted by the parser (`cre/index.ts`) and consumed
 * by the format adapter's semantic-key router (`cre/format-adapter.ts`).
 * Keeping them in one place prevents the two sites from drifting silently.
 */
export const CRE_GROUP_LABELS = {
    file: "CRE File",
    header: "CRE Header",
    knownSpells: "Known Spells",
    spellMemInfo: "Spell Memorization Info",
    memorizedSpells: "Memorized Spells",
    effects: "Effects",
    items: "Items",
    itemSlots: "Item Slots",
} as const;

export const CRE_HEADER_SIZE = 0x2d4;
export const CRE_KNOWN_SPELL_SIZE = 0x0c;
export const CRE_SPELL_MEM_INFO_SIZE = 0x10;
export const CRE_MEMORIZED_SPELL_SIZE = 0x0c;
export const CRE_ITEM_SIZE = 0x14;
export const CRE_EFFECT_V1_SIZE = 0x30;
export const CRE_EFFECT_V2_SIZE = 0x108;
export const CRE_ITEM_SLOT_COUNT = 40;
export const CRE_ITEM_SLOTS_SIZE = CRE_ITEM_SLOT_COUNT * 2;

export const CRE_SIGNATURE = [0x43, 0x52, 0x45, 0x20] as const; // 'CRE '
export const CRE_VERSION_V1 = [0x56, 0x31, 0x2e, 0x30] as const; // 'V1.0'

// -- Header enum/flag lookups -----------------------------------------------

/** CRE header `creatureFlags` (dword bitmap, 0x0010). */
export const CreCreatureFlags: Readonly<Record<number, string>> = {
    0x00000002: "No corpse",
    0x00000004: "Keep corpse",
    0x00000008: "Original class Fighter",
    0x00000010: "Original class Mage",
    0x00000020: "Original class Cleric",
    0x00000040: "Original class Thief",
    0x00000080: "Original class Druid",
    0x00000100: "Original class Ranger",
    0x00000200: "Fallen Paladin",
    0x00000400: "Fallen Ranger",
    0x00000800: "Exportable",
    0x00002000: "Quest critical",
    0x00004000: "Moving between areas",
    0x00008000: "Been in party",
    0x00100000: "Prevent exploding death",
    0x00400000: "No nightmare modifiers",
    0x00800000: "No tooltip",
};

/** CRE header `statusFlags` (dword bitmap, 0x0020). Mirrors STATE.IDS. */
export const CreStatusFlags: Readonly<Record<number, string>> = {
    0x00000001: "Sleeping",
    0x00000002: "Berserk",
    0x00000004: "Panic",
    0x00000008: "Stunned",
    0x00000010: "Invisible",
    0x00000020: "Helpless",
    0x00000040: "Frozen death",
    0x00000080: "Stone death",
    0x00000100: "Exploding death",
    0x00000200: "Flame death",
    0x00000400: "Acid death",
    0x00000800: "Dead",
    0x00001000: "Silenced",
    0x00002000: "Charmed",
    0x00004000: "Poisoned",
    0x00008000: "Hasted",
    0x00010000: "Slowed",
    0x00020000: "Infravision",
    0x00040000: "Blind",
    0x00080000: "Diseased",
    0x00100000: "Feebleminded",
    0x00200000: "Nondetection",
    0x00400000: "Improved invisibility",
    0x00800000: "Bless",
    0x01000000: "Chant",
    0x02000000: "Draw upon holy might",
    0x04000000: "Luck",
    0x08000000: "Aid",
    0x10000000: "Chant bad",
    0x20000000: "Blur",
    0x40000000: "Mirror image",
    0x80000000: "Confused",
};

/** CRE header `effStructureVersion` (byte, 0x0033). */
export const CreEffStructureVersion: Readonly<Record<number, string>> = {
    0: "Version 1 EFF",
    1: "Version 2 EFF",
};

/** CRE header `sex` (byte, 0x0237) - GENDER.IDS. */
export const CreSex: Readonly<Record<number, string>> = {
    0: "Sexless",
    1: "Male",
    2: "Female",
    3: "Other",
    4: "Niether",
    5: "Both",
};

/** CRE header `enemyAlly` (byte, 0x0270) - EA.IDS common values. */
export const CreEnemyAlly: Readonly<Record<number, string>> = {
    1: "Inanimate",
    2: "Player1",
    3: "Player2",
    4: "Player3",
    5: "Player4",
    6: "Player5",
    7: "Player6",
    28: "Familiar",
    29: "Ally",
    30: "Controlled",
    31: "Charmed",
    32: "Reallycharmed",
    126: "Goodbutblue",
    127: "Goodbutred",
    128: "Neutral",
    198: "Evilbutgreen",
    199: "Evilbutblue",
    200: "Charmedpc",
    201: "Evilcutoff",
    202: "Notgood",
    203: "Notneutral",
    204: "Notevil",
    205: "Anything",
    206: "Areaobject",
    254: "Pc_target",
    255: "Enemy",
};

/** CRE header `general` (byte, 0x0271) - GENERAL.IDS common values. */
export const CreGeneral: Readonly<Record<number, string>> = {
    0: "None",
    1: "Humanoid",
    2: "Animal",
    3: "Dead",
    4: "Undead",
    5: "Giant Humanoid",
    6: "Monster",
    100: "Helmed Horror",
    255: "Anything",
};

/** CRE header `race` (byte, 0x0272) - RACE.IDS common values. */
export const CreRace: Readonly<Record<number, string>> = {
    0: "None",
    1: "Human",
    2: "Elf",
    3: "Half elf",
    4: "Dwarf",
    5: "Halfling",
    6: "Gnome",
    7: "Half orc",
    8: "Goblin",
    9: "Hobgoblin",
    10: "Dwarf werewolf",
    11: "Half elf werewolf",
    100: "Monster",
    255: "Anything",
};

/** CRE header `class` (byte, 0x0273) - CLASS.IDS common values. */
export const CreClass: Readonly<Record<number, string>> = {
    0: "None",
    1: "Mage",
    2: "Fighter",
    3: "Cleric",
    4: "Thief",
    5: "Bard",
    6: "Paladin",
    7: "Fighter mage",
    8: "Fighter cleric",
    9: "Fighter thief",
    10: "Fighter mage thief",
    11: "Mage thief",
    12: "Cleric mage",
    13: "Cleric thief",
    14: "Fighter druid",
    15: "Fighter mage cleric",
    16: "Cleric ranger",
    17: "Fighter druid mage",
    18: "Fighter druid cleric",
    19: "Mage druid",
    20: "Mage druid cleric",
    21: "Fighter mage druid",
    22: "Fighter mage druid cleric",
    23: "Ranger",
    24: "Druid",
    25: "Monk",
    26: "Sorcerer",
    27: "Shaman",
    200: "Innate",
    255: "Anything",
};

/** CRE header `alignment` (byte, 0x027B) - ALIGNMEN.IDS. */
export const CreAlignment: Readonly<Record<number, string>> = {
    0x11: "Lawful good",
    0x12: "Lawful neutral",
    0x13: "Lawful evil",
    0x21: "Neutral good",
    0x22: "Neutral",
    0x23: "Neutral evil",
    0x31: "Chaotic good",
    0x32: "Chaotic neutral",
    0x33: "Chaotic evil",
    0x14: "Lawful",
    0x24: "True neutral",
    0x34: "Chaotic",
    0x41: "Good",
    0x42: "Mask of neutral",
    0x43: "Evil",
    0x44: "Anything",
};

/**
 * CRE header `kit` (dword, 0x0244) - KIT.IDS values from IESDP cre_v1.htm. Keyed by the dword the LE u32
 * codec reads, which matches the IESDP "KIT_*" hex directly. Read LITTLE-endian: across the vendored CRE v1
 * corpus the LE read matches KIT.IDS in 151/153 files, including 34 warrior-range kits (0x40xx0000, e.g.
 * True Class is stored `00 00 00 40` -> 0x40000000) that a big-endian read would garble - so IESDP's
 * "values ... written in big endian style" note does not hold for the files we parse. Open enum: mods add
 * kits beyond this engine-defined set, so out-of-table values surface as Unknown(N).
 */
export const CreKit: Readonly<Record<number, string>> = {
    0x00000000: "None",
    0x00004000: "Barbarian",
    0x40000000: "True class",
    0x40010000: "Berserker",
    0x40020000: "Wizard slayer",
    0x40030000: "Kensai",
    0x40040000: "Cavalier",
    0x40050000: "Inquisitor",
    0x40060000: "Undead hunter",
    0x40070000: "Archer",
    0x40080000: "Stalker",
    0x40090000: "Beast master",
    0x400a0000: "Assassin",
    0x400b0000: "Bounty hunter",
    0x400c0000: "Swashbuckler",
    0x400d0000: "Blade",
    0x400e0000: "Jester",
    0x400f0000: "Skald",
    0x40100000: "Totemic druid",
    0x40110000: "Shapeshifter",
    0x40120000: "Avenger",
    0x40130000: "Priest of Talos",
    0x40140000: "Priest of Helm",
    0x40150000: "Priest of Lathander",
    0x00400000: "Abjurer",
    0x00800000: "Conjurer",
    0x01000000: "Diviner",
    0x02000000: "Enchanter",
    0x04000000: "Illusionist",
    0x08000000: "Invoker",
    0x10000000: "Necromancer",
    0x20000000: "Transmuter",
};

// `gender` (byte, 0x0275) reuses the GENDER.IDS table via `CreSex` directly -
// no separate `CreGender` alias to avoid a duplicate export.

// -- Sub-record lookups -----------------------------------------------------

/** Spell-type word shared by known-spells and spell-mem-info records. */
export const CreSpellType: Readonly<Record<number, string>> = {
    0: "Priest",
    1: "Wizard",
    2: "Innate",
};

/** Memorised-spell `memorizedFlags` (dword bitmap). */
export const CreMemorizedSpellFlags: Readonly<Record<number, string>> = {
    0x00000001: "Memorized",
    0x00000002: "Disabled",
};

/** Item `itemFlags` (dword bitmap). */
export const CreItemFlags: Readonly<Record<number, string>> = {
    0x00000001: "Identified",
    0x00000002: "Unstealable",
    0x00000004: "Stolen",
    0x00000008: "Undroppable",
};

// -- Item-slot labels --------------------------------------------------------

/**
 * BG1 / BG2 / BGEE item-slot order. The slot table is a flat array of 40
 * i16 entries: the first 38 are inventory indices into the items table
 * (-1 == empty), entry 38 is "Selected weapon" (an inventory-slot index
 * indicating which weapon slot is currently equipped, or 1000 for fists),
 * entry 39 is "Selected weapon ability" (the header-index of the active
 * ability on that weapon).
 *
 * PSTEE uses a different layout (40 slots for non-party creatures, up to
 * 57 for party members) keyed off the byte at offset 0x7C ("Number of
 * available inventory slots", 0 = default). Adding PSTEE support means
 * picking a second labels table at runtime from header bytes; the wire
 * shape stays an i16 array, so the round-trip / serialization path is
 * unaffected. See IESDP cre_v1.htm "CRE V1.0 Item Slots" section.
 */
export const CRE_ITEM_SLOT_LABELS = [
    "Helmet",
    "Armor",
    "Shield",
    "Gloves",
    "Left ring",
    "Right ring",
    "Amulet",
    "Belt",
    "Boots",
    "Weapon 1",
    "Weapon 2",
    "Weapon 3",
    "Weapon 4",
    "Quiver 1",
    "Quiver 2",
    "Quiver 3",
    "Quiver 4",
    "Cloak",
    "Quick item 1",
    "Quick item 2",
    "Quick item 3",
    "Inventory 1",
    "Inventory 2",
    "Inventory 3",
    "Inventory 4",
    "Inventory 5",
    "Inventory 6",
    "Inventory 7",
    "Inventory 8",
    "Inventory 9",
    "Inventory 10",
    "Inventory 11",
    "Inventory 12",
    "Inventory 13",
    "Inventory 14",
    "Inventory 15",
    "Inventory 16",
    "Magic weapon",
    "Selected weapon",
    "Selected weapon ability",
] as const;
