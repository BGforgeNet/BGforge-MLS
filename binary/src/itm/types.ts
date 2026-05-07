/**
 * ITM v1 wire constants and ITM-specific enum / flag lookup tables.
 *
 * Tables are sourced from the IESDP `itm_v1/header.yml` and
 * `itm_v1/extended_header.yml` `desc:` Markdown bullet lists. Used by
 * `<file>.overrides.ts` to augment the generated bare spec with display
 * lookups; the augmented spec drives walkStruct rendering and
 * `toZodSchema`'s strict-mode enum membership refinement.
 *
 * `EFFECT_SIZE`, `bytesEqual`, and shared IE effect/ability lookups live in
 * `../ie-common/types`.
 */

/** Bytes consumed by the ITM v1 header. */
export const ITM_HEADER_SIZE = 0x72;
/** Bytes consumed by one ITM extended-header (ability) record. */
export const ITM_ABILITY_SIZE = 0x38;

/** Wire bytes (4 ASCII chars) for ITM signature. */
export const ITM_SIGNATURE = [0x49, 0x54, 0x4d, 0x20] as const; // "ITM "
/** Wire bytes (4 ASCII chars) for ITM v1 version. */
export const ITM_VERSION_V1 = [0x56, 0x31, 0x20, 0x20] as const; // "V1  "

// -- Header lookups ---------------------------------------------------------

/** ITM header `flags` (dword bitmap). */
export const ItmFlags: Readonly<Record<number, string>> = {
    0x00000001: "Critical item",
    0x00000002: "Two-handed",
    0x00000004: "Movable",
    0x00000008: "Displayable",
    0x00000010: "Cursed",
    0x00000020: "Cannot be scribed",
    0x00000040: "Magical",
    0x00000080: "Left-handed",
    0x00000100: "Silver",
    0x00000200: "Cold iron",
    0x00000400: "Stolen",
    0x00000800: "Conversable",
    0x00001000: "Pulsating",
};

/**
 * ITM header `type` (word). Common values from IESDP `itemtype.ids`. Out-of-
 * table values surface as `Unknown (N)` in the editor; the strict canonical
 * gate accepts only enumerated keys.
 */
export const ItmType: Readonly<Record<number, string>> = {
    0: "Books",
    1: "Amulets / Necklaces",
    2: "Armor",
    3: "Belts / Girdles",
    4: "Boots",
    5: "Arrows",
    6: "Bracers / Gauntlets",
    7: "Headgear",
    8: "Keys",
    9: "Potions",
    10: "Rings",
    11: "Scrolls",
    12: "Shields",
    13: "Food",
    14: "Bullets",
    15: "Bows",
    16: "Daggers",
    17: "Maces",
    18: "Slings",
    19: "Small Swords",
    20: "Large Swords",
    21: "Hammers",
    22: "Morning Stars",
    23: "Flails",
    24: "Darts",
    25: "Axes",
    26: "Quarterstaves",
    27: "Crossbows",
    28: "Hand-to-Hand",
    29: "Spears",
    30: "Halberds",
    31: "Bolts",
    32: "Cloaks",
    33: "Gold",
    34: "Gems",
    35: "Wands",
    36: "Containers",
    37: "Books",
    38: "Familiars",
    39: "Tattoos (PST)",
    40: "Lenses (PST)",
    41: "Buckler",
    42: "Candle",
    44: "Club",
    47: "Large shield",
    49: "Medium shield",
    50: "Notes",
    53: "Small shield",
    57: "Telescope",
    58: "Drink",
    59: "Great sword",
    60: "Container",
    61: "Fur / pelt",
    62: "Leather armor",
    63: "Studded leather",
    64: "Chain mail",
    65: "Splint mail",
    66: "Half plate",
    67: "Full plate",
    68: "Hide armor",
    69: "Robe",
    71: "Bastard sword",
    72: "Scarf",
    73: "Food",
    74: "Hat",
    75: "Gauntlet",
};

/**
 * ITM header `usabilityFlags` is a 4-byte block (offset 0x1E) where each
 * byte carries a *different* bitmap. Per IESDP `#Header_Usability`:
 *
 * - Byte 1: alignment matrix (bits 0–5 form chaotic/lawful/neutral × evil/
 *   good/neutral combinations) plus class flags Bard, Cleric (bits 6–7).
 * - Byte 2: class flags (Cleric/Mage, Cleric/Thief, Cleric/Ranger, Fighter,
 *   Fighter/Druid, Fighter/Mage, Fighter/Cleric, Fighter/Mage/Cleric).
 * - Byte 3: more class flags (multi-class permutations) plus race Elf.
 * - Byte 4: race flags (Dwarf, Half-Elf, Halfling, Human, Gnome, Monk,
 *   Druid/Shaman, Half-Orc).
 *
 * The four tables ship as separate Records so the per-byte editor row can
 * decode each byte independently. Used as the `slotElements` for the
 * `usabilityFlags` arraySpec in `header.overrides.ts`.
 */
export const ItmUsabilityByte1Flags: Readonly<Record<number, string>> = {
    0x01: "Chaotic...",
    0x02: "...Evil",
    0x04: "...Good",
    0x08: "...Neutral",
    0x10: "Lawful...",
    0x20: "Neutral...",
    0x40: "Bard",
    0x80: "Cleric",
};

export const ItmUsabilityByte2Flags: Readonly<Record<number, string>> = {
    0x01: "Cleric/Mage",
    0x02: "Cleric/Thief",
    0x04: "Cleric/Ranger",
    0x08: "Fighter",
    0x10: "Fighter/Druid",
    0x20: "Fighter/Mage",
    0x40: "Fighter/Cleric",
    0x80: "Fighter/Mage/Cleric",
};

export const ItmUsabilityByte3Flags: Readonly<Record<number, string>> = {
    0x01: "Fighter/Mage/Thief",
    0x02: "Fighter/Thief",
    0x04: "Mage and Sorcerer",
    0x08: "Mage/Thief",
    0x10: "Paladin",
    0x20: "Ranger",
    0x40: "Thief",
    0x80: "Elf",
};

export const ItmUsabilityByte4Flags: Readonly<Record<number, string>> = {
    0x01: "Dwarf",
    0x02: "Half-Elf",
    0x04: "Halfling",
    0x08: "Human",
    0x10: "Gnome",
    0x20: "Monk",
    0x40: "Druid / Shaman (EE)",
    0x80: "Half-Orc",
};

// -- Ability (extended_header) lookups --------------------------------------

/** ITM ability `attackType` (char). */
export const ItmAbilityAttackType: Readonly<Record<number, string>> = {
    0: "None",
    1: "Melee",
    2: "Ranged",
    3: "Magical",
    4: "Launcher",
};

/** ITM ability `location` (char). */
export const ItmAbilityLocation: Readonly<Record<number, string>> = {
    0: "None",
    1: "Weapon",
    2: "Spell",
    3: "Equipment / Item",
    4: "Innate",
};

/** ITM ability `projectileType` (byte): which launcher class is required. */
export const ItmAbilityProjectileType: Readonly<Record<number, string>> = {
    0: "None",
    1: "Bow",
    2: "Crossbow",
    3: "Sling",
    40: "Spear",
    100: "Throwing Axe",
};

/** ITM ability `damageType` (word). */
export const ItmAbilityDamageType: Readonly<Record<number, string>> = {
    0: "None",
    1: "Piercing",
    2: "Crushing",
    3: "Slashing",
    4: "Missile",
    5: "Fist",
    6: "Piercing/Crushing (better)",
    7: "Piercing/Slashing (better)",
    8: "Crushing/Slashing (worse)",
    9: "Blunt Missile",
};

/** ITM ability `depletion` (word) — what happens when charges hit 0. */
export const ItmAbilityDepletion: Readonly<Record<number, string>> = {
    0: "Item remains",
    1: "Item vanishes",
    2: "Replace with used-up version",
    3: "Item recharges",
};

/** ITM ability `flags` (dword bitmap). */
export const ItmAbilityFlags: Readonly<Record<number, string>> = {
    0x00000001: "Add strength bonus",
    0x00000002: "Breakable",
    0x00040000: "Hostile",
    0x00080000: "Recharge after resting",
    0x01000000: "Bypass armor",
    0x02000000: "Keen edge",
};
