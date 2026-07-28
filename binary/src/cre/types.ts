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
/**
 * Inventory slots [0, CRE_ITEM_REF_SLOT_COUNT) hold item-table indices; the trailing two entries are the
 * selected-weapon slot index and ability index (see CRE_ITEM_SLOT_LABELS), which are NOT item indices.
 * The single source of truth shared by the itemSlots relink and the editor's cross-record diagnostics.
 */
export const CRE_ITEM_REF_SLOT_COUNT = CRE_ITEM_SLOT_COUNT - 2; // 38

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

/** CRE header `statusFlags` (dword bitmap, 0x0020). Mirrors STATE.IDS: https://iesdp.bgforge.net/files/ids/bgee/state.htm */
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

/*
 * The IDS-backed tables below (sex/gender, enemyAlly, general, specific, race, class, alignment, kit) carry the
 * game's OWN identifiers verbatim - HALF_ELF, MAGESCHOOL_ABJURER, ASSASIN with the engine's misspelling - not a
 * humanized rendering of them. Each field also declares an `ids` ref (see `specs/header.overrides.ts`), so with
 * a game open that install's table merges in on top; keeping one vocabulary means the editor reads the same
 * with or without a game, and it is the vocabulary a script author types. The `0` entries are the exception:
 * no IDS names 0 for these fields, so it stays the editor's own word for "unset" rather than a fabricated
 * identifier.
 */

/**
 * CRE header `sex` (byte, 0x0237) - GENDER.IDS: https://iesdp.bgforge.net/files/ids/bgee/gender.htm
 * `0: "Sexless"` is a curated unset sentinel (GENDER.IDS starts at 1). Names mirror the IDS spelling, including
 * its "Niether" typo. The high EXTRA2-10 filler values (10-18) are omitted; the enum is open, so they surface
 * as "<n> Unknown".
 */
export const CreSex: Readonly<Record<number, string>> = {
    0: "Sexless",
    1: "MALE",
    2: "FEMALE",
    3: "OTHER",
    4: "NIETHER",
    5: "BOTH",
    6: "SUMMONED",
    7: "ILLUSIONARY",
    9: "SUMMONED_DEMON",
};

/** CRE header `enemyAlly` (byte, 0x0270) - EA.IDS: https://iesdp.bgforge.net/files/ids/bgee/ea.htm */
export const CreEnemyAlly: Readonly<Record<number, string>> = {
    0: "ANYONE",
    1: "INANIMATE",
    2: "PC",
    3: "FAMILIAR",
    4: "ALLY",
    5: "CONTROLLED",
    6: "CHARMED",
    7: "REALLYCHARMED",
    28: "GOODBUTRED",
    29: "GOODBUTBLUE",
    30: "GOODCUTOFF",
    31: "NOTGOOD",
    126: "ANYTHING",
    127: "AREAOBJECT",
    128: "NEUTRAL",
    198: "NOTNEUTRAL",
    199: "NOTEVIL",
    200: "EVILCUTOFF",
    201: "EVILBUTGREEN",
    202: "EVILBUTBLUE",
    254: "CHARMED_PC",
    255: "ENEMY",
};

/**
 * CRE header `general` (byte, 0x0271) - creature GENERAL.IDS values from
 * https://iesdp.bgforge.net/files/ids/bgee/general.htm `0: "None"` is a curated unset sentinel (in the
 * IDS, 0 is GENERAL_ITEM, an item-only type that never applies to a creature). The item GENERAL.IDS types
 * (101-113 WEAPON/ARMOR/...) are omitted as they are not creature values.
 */
export const CreGeneral: Readonly<Record<number, string>> = {
    0: "GENERAL_ITEM",
    1: "HUMANOID",
    2: "ANIMAL",
    3: "DEAD",
    4: "UNDEAD",
    5: "GIANTHUMANOID",
    6: "FROZEN",
    7: "PLANT",
    255: "MONSTER",
};

/**
 * CRE header `specific` (byte, 0x0274) - SPECIFIC.IDS, from
 * https://iesdp.bgforge.net/files/ids/bgee/specific.htm.
 * `0: "None"` is a curated sentinel for the common unset value - it is NOT in the BGEE IDS, but mirrors the
 * `0` entries in CreGeneral / CreRace. Open enum: SPECIFIC.IDS varies by game and is mod-extensible, so
 * unlisted values round-trip as `Unknown (N)`.
 */
export const CreSpecific: Readonly<Record<number, string>> = {
    0: "None",
    1: "NORMAL",
    10: "CULTIST",
    12: "SHARRAN",
    64: "SHOU_MONK",
    65: "SHOU_FLAYER",
    66: "QUADIM_SPIDER",
    67: "CULAK_SPIDER",
    101: "MAGIC",
    102: "NO_MAGIC",
    250: "SPIRIT",
};

/**
 * CRE header `race` (byte, 0x0272) - playable RACE.IDS values from
 * https://iesdp.bgforge.net/files/ids/bgee/race.htm `0: "None"` is a curated unset sentinel (RACE.IDS
 * starts at 1). RACE.IDS also defines creature-type races (101+, e.g. ANKHEG/TROLL); those are omitted as they
 * are not playable races. The enum is open, so any omitted value renders as "<n> Unknown".
 */
export const CreRace: Readonly<Record<number, string>> = {
    0: "None",
    1: "HUMAN",
    2: "ELF",
    3: "HALF_ELF",
    4: "DWARF",
    5: "HALFLING",
    6: "GNOME",
    7: "HALFORC",
};

/**
 * CRE header `class` (byte, 0x0273) - single- and multi-class player/NPC values from BGEE CLASS.IDS
 * (https://iesdp.bgforge.net/files/ids/bgee/class.htm). `0: "None"` is a curated unset sentinel (not in the
 * IDS), mirroring CreGeneral/CreRace; `255` is the IDS NO_CLASS. CLASS.IDS also defines creature-type detection
 * classes (101-200, e.g. OGRE_MAGE/TROLL) and script-only "_ALL"/weapon detection values (201-210); those are
 * omitted as they are not player/NPC class-byte values. The enum is open (enumOpen), so any omitted value still
 * renders as "<n> Unknown".
 */
export const CreClass: Readonly<Record<number, string>> = {
    0: "None",
    1: "MAGE",
    2: "FIGHTER",
    3: "CLERIC",
    4: "THIEF",
    5: "BARD",
    6: "PALADIN",
    7: "FIGHTER_MAGE",
    8: "FIGHTER_CLERIC",
    9: "FIGHTER_THIEF",
    10: "FIGHTER_MAGE_THIEF",
    11: "DRUID",
    12: "RANGER",
    13: "MAGE_THIEF",
    14: "CLERIC_MAGE",
    15: "CLERIC_THIEF",
    16: "FIGHTER_DRUID",
    17: "FIGHTER_MAGE_CLERIC",
    18: "CLERIC_RANGER",
    19: "SORCERER",
    20: "MONK",
    21: "SHAMAN",
    255: "NO_CLASS",
};

/**
 * CRE header `alignment` (byte, 0x027B) - ALIGNMEN.IDS from
 * https://iesdp.bgforge.net/files/ids/bgee/alignmen.htm Only the nine concrete alignments a creature
 * stores (plus `0x00` NONE) are listed; the partial-match bitmasks (MASK_GOOD 0x01, MASK_LAWFUL 0x10, etc.) are
 * script-check values, not stored creature alignments, so they are omitted.
 */
export const CreAlignment: Readonly<Record<number, string>> = {
    0x00: "NONE",
    0x11: "LAWFUL_GOOD",
    0x12: "LAWFUL_NEUTRAL",
    0x13: "LAWFUL_EVIL",
    0x21: "NEUTRAL_GOOD",
    0x22: "NEUTRAL",
    0x23: "NEUTRAL_EVIL",
    0x31: "CHAOTIC_GOOD",
    0x32: "CHAOTIC_NEUTRAL",
    0x33: "CHAOTIC_EVIL",
};

/**
 * CRE header `kit` (dword, 0x0244) - KIT.IDS values: https://iesdp.bgforge.net/files/ids/bgee/kit.htm
 * Labels are the BG2EE in-game kit names; some KIT.IDS identifiers differ (0x4007 = Archer/FERALAN,
 * 0x4012 = Avenger/BEASTFRIEND). Keyed by the dword the LE u32
 * codec reads, which matches the IESDP "KIT_*" hex directly. Read LITTLE-endian: across the vendored CRE v1
 * corpus the LE read matches KIT.IDS in 151/153 files, including 34 warrior-range kits (0x40xx0000, e.g.
 * True Class is stored `00 00 00 40` -> 0x40000000) that a big-endian read would garble - so IESDP's
 * "values ... written in big endian style" note does not hold for the files we parse. Open enum: mods add
 * kits beyond this engine-defined set, so out-of-table values surface as Unknown(N).
 */
export const CreKit: Readonly<Record<number, string>> = {
    0x00000000: "None",
    0x40000000: "MAGESCHOOL_GENERALIST",
    0x40010000: "BERSERKER",
    0x40020000: "WIZARDSLAYER",
    0x40030000: "KENSAI",
    0x40040000: "CAVALIER",
    0x40050000: "INQUISITOR",
    0x40060000: "UNDEADHUNTER",
    0x40070000: "FERALAN",
    0x40080000: "STALKER",
    0x40090000: "BEASTMASTER",
    0x400a0000: "ASSASIN",
    0x400b0000: "BOUNTYHUNTER",
    0x400c0000: "SWASHBUCKLER",
    0x400d0000: "BLADE",
    0x400e0000: "JESTER",
    0x400f0000: "SKALD",
    0x40100000: "TOTEMIC",
    0x40110000: "SHAPESHIFTER",
    0x40120000: "BEASTFRIEND",
    0x40130000: "GODTALOS",
    0x40140000: "GODHELM",
    0x40150000: "GODLATHANDER",
    0x00400000: "MAGESCHOOL_ABJURER",
    0x00800000: "MAGESCHOOL_CONJURER",
    0x01000000: "MAGESCHOOL_DIVINER",
    0x02000000: "MAGESCHOOL_ENCHANTER",
    0x04000000: "MAGESCHOOL_ILLUSIONIST",
    0x08000000: "MAGESCHOOL_INVOKER",
    0x10000000: "MAGESCHOOL_NECROMANCER",
    0x20000000: "MAGESCHOOL_TRANSMUTER",
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

/**
 * Valid values for the "Selected weapon" slot (entry 38). Per IESDP cre_v1.htm: the value is the slots.ids
 * index minus 35, and the four weapon slots begin at slots.ids index 35 - so 0-3 select Weapon 1-4, and the
 * special value 1000 means fists (no weapon equipped). A fixed engine enum, not an item-table reference.
 */
export const CRE_SELECTED_WEAPON_OPTIONS: Readonly<Record<string, string>> = {
    "0": "Weapon 1",
    "1": "Weapon 2",
    "2": "Weapon 3",
    "3": "Weapon 4",
    "1000": "Fist",
};
