/**
 * SPL v1 wire constants and SPL-specific enum / flag lookup tables.
 *
 * Effects share their on-wire layout (and lookups) with ITM via
 * `ie-common`; abilities are SPL-specific (40 bytes, different fields than
 * ITM's 56-byte ability) and have their own enum/flag tables here.
 */

/** Bytes consumed by the SPL v1 header. */
export const SPL_HEADER_SIZE = 0x72;
/** Bytes consumed by one SPL extended-header (ability) record. Differs from ITM (0x38). */
export const SPL_ABILITY_SIZE = 0x28;

/** Wire bytes for SPL signature ('SPL '). */
export const SPL_SIGNATURE = [0x53, 0x50, 0x4c, 0x20] as const;
/** Wire bytes for SPL v1 version ('V1  '). */
export const SPL_VERSION_V1 = [0x56, 0x31, 0x20, 0x20] as const;

// -- Header lookups ---------------------------------------------------------

/**
 * SPL header `flags` (dword bitmap). Bit positions per IESDP spl_v1 Header Flags
 * (spl_v1.htm #Header_Flags). That table is a Bit(0-7) x Byte(1-4) grid, so a cell at
 * Byte N / bit b is dword bit 8*(N-1)+b (e.g. Byte 2 bit 2 -> dword bit 10 -> mask 0x400).
 * Byte 1 is entirely Unknown; the named flags live in bytes 2-4.
 */
export const SplFlags: Readonly<Record<number, string>> = {
    0x00000200: "Breaks Sanctuary / Invisibility (EE)",
    0x00000400: "Hostile",
    0x00000800: "No LOS required",
    0x00001000: "Allow spotting",
    0x00002000: "Outdoors only",
    0x00004000: "Ignore dead-magic and wild surge effect",
    0x00008000: "Ignore wild surge effect (trigger/contingency)",
    0x00010000: "Not in combat",
    0x01000000: "Can target invisible (BGEE, ToBEx)",
    0x02000000: "Castable when silenced (BGEE, ToBEx)",
};

/**
 * SPL header `type` (Spell type - wizard/priest/innate/etc.). Drives which
 * casting message and SPELLFAILURE stat the engine uses.
 */
export const SplType: Readonly<Record<number, string>> = {
    0: "Special",
    1: "Wizard",
    2: "Priest",
    3: "Psionic",
    4: "Innate",
    5: "Bard song",
};

/**
 * SPL header `exclusionFlags` (dword bitmap): which class/alignment groups are BARRED from learning or
 * casting this spell. Bit meanings per IESDP spl_v1 Exclusion Flags (spl_v1.htm #Exclusion_Flags):
 * bits 0-5 exclude priests by alignment, bits 6-13 exclude specialist mages (the opposition-school
 * mechanic), bit 14 is Wild Magic, bits 30-31 exclude the hybrid priest classes. Alignment and
 * school/specialist bits are not combined in one spell (spl_v1.htm note).
 */
export const SplExclusionFlags: Readonly<Record<number, string>> = {
    0x00000001: "Exclude Chaotic priests",
    0x00000002: "Exclude Evil priests",
    0x00000004: "Exclude Good priests",
    0x00000008: "Exclude GE-Neutral priests",
    0x00000010: "Exclude Lawful priests",
    0x00000020: "Exclude LC-Neutral priests",
    0x00000040: "Exclude Abjurers",
    0x00000080: "Exclude Conjurers",
    0x00000100: "Exclude Diviners",
    0x00000200: "Exclude Enchanters",
    0x00000400: "Exclude Illusionists",
    0x00000800: "Exclude Invokers",
    0x00001000: "Exclude Necromancers",
    0x00002000: "Exclude Transmuters",
    0x00004000: "Wild Magic (exclude Generalists)",
    0x40000000: "Exclude Cleric/Paladin",
    0x80000000: "Exclude Druid/Ranger",
};

/**
 * SPL header `castingGraphics` (word) - visual effect during cast. Decimal values per IESDP spl_v1
 * Casting Graphics, BG1/BG2/IWD column (spl_v1.htm #Header_Casting_Graphics): 0-8 are all "No animation",
 * 9-16 are the eight school animations, 17-34 are sprklclr.2da spark colours, and 56461 / 65535 are
 * sentinels for no animation. (The PST 35-44 column is a different game and omitted.)
 */
export const SplCastingGraphics: Readonly<Record<number, string>> = {
    0: "No animation",
    1: "No animation",
    2: "No animation",
    3: "No animation",
    4: "No animation",
    5: "No animation",
    6: "No animation",
    7: "No animation",
    8: "No animation",
    9: "Necromancy",
    10: "Alteration",
    11: "Enchantment",
    12: "Abjuration",
    13: "Illusion",
    14: "Conjuration",
    15: "Invocation",
    16: "Divination",
    17: "White sparks",
    18: "Black sparks",
    19: "White sparks",
    20: "White sparks",
    21: "White sparks",
    22: "White -> red sparks",
    23: "White -> purple/red sparks",
    24: "White -> red sparks",
    26: "White sparks",
    32: "White sparks",
    34: "White sparks",
    56461: "No animation",
    65535: "No animation",
};

// -- Ability (extended_header) lookups --------------------------------------

/** SPL ability `form` (char). */
export const SplAbilityForm: Readonly<Record<number, string>> = {
    1: "Standard",
    2: "Projectile",
};

/**
 * SPL ability `friendly` (char bitmap). IESDP spl_v1 extended header documents a single bit here:
 * bit 2 (0x04) = "Friendly" ability, PST only (extended_header.yml `friendly`). The prior 0x01
 * "Hostile" / 0x02 "Friendly" entries were not in the spec.
 */
export const SplAbilityFriendly: Readonly<Record<number, string>> = {
    0x04: "Friendly (PST only)",
};

/** SPL ability `location` (word). */
export const SplAbilityLocation: Readonly<Record<number, string>> = {
    0: "None",
    1: "Weapon",
    2: "Spell",
    3: "Equipment / Item",
    4: "Innate",
};
