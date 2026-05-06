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

/** SPL header `flags` (dword bitmap). */
export const SplFlags: Readonly<Record<number, string>> = {
    0x00000040: "No LOS required",
    0x00000400: "Allow spotting",
    0x00000800: "Outdoors only",
    0x00001000: "Non-magical ability",
    0x00002000: "Trigger / Contingency",
    0x00004000: "Non-combat ability",
};

/**
 * SPL header `type` (Spell type — wizard/priest/innate/etc.). Drives which
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
 * SPL header `exclusionFlags` (school-exclusion bitmap). Combinable with
 * other school flags via OR; engines use it for opposing schools and the
 * "school grants immunity" mechanic.
 */
export const SplExclusionFlags: Readonly<Record<number, string>> = {
    0x00000001: "School: Chaos",
    0x00000002: "School: Evil",
    0x00000004: "School: Good",
    0x00000008: "School: Law",
    0x00000010: "School: Magic",
    0x00000020: "School: Trap",
    0x00000040: "Divination",
    0x00000080: "Enchantment",
    0x00000100: "Illusion",
    0x00000200: "Invocation",
    0x00000400: "Necromancy",
    0x00000800: "Alteration",
    0x00001000: "Abjurer",
    0x00002000: "Conjurer",
    0x00004000: "Diviner",
    0x00008000: "Enchanter",
    0x00010000: "Illusionist",
    0x00020000: "Invoker",
    0x00040000: "Necromancer",
    0x00080000: "Transmuter",
    0x00100000: "Generalist",
};

/** SPL header `castingGraphics` (word) — visual effect during cast. */
export const SplCastingGraphics: Readonly<Record<number, string>> = {
    0: "Necromancy",
    1: "Alteration",
    2: "Enchantment",
    3: "Abjuration",
    4: "Illusion",
    5: "Conjuration",
    6: "Invocation",
    7: "Divination",
    8: "Cleric Necromancy",
    9: "Cleric Alteration",
    10: "Cleric Enchantment",
    11: "Cleric Abjuration",
    12: "Cleric Illusion",
    13: "Cleric Conjuration",
    14: "Cleric Invocation",
    15: "Cleric Divination",
};

// -- Ability (extended_header) lookups --------------------------------------

/** SPL ability `form` (char). */
export const SplAbilityForm: Readonly<Record<number, string>> = {
    1: "Standard",
    2: "Projectile",
};

/** SPL ability `friendly` (char) — friendly-fire bit flags. */
export const SplAbilityFriendly: Readonly<Record<number, string>> = {
    0x01: "Hostile",
    0x02: "Friendly",
};

/** SPL ability `location` (word). */
export const SplAbilityLocation: Readonly<Record<number, string>> = {
    0: "None",
    1: "Weapon",
    2: "Spell",
    3: "Equipment / Item",
    4: "Innate",
};
