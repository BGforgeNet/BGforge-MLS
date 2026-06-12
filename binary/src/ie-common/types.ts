/**
 * Shared Infinity Engine wire constants and helpers.
 *
 * EFFECT_SIZE is shared because the on-wire feature_block layout is
 * byte-identical between ITM and SPL (and is generated once into
 * `ie-common/specs/effect.ts`). Ability size is per-format and lives in
 * `<format>/types.ts`.
 *
 * Enum / flag tables in this file are the IE-wide ones - used for fields
 * that appear in multiple formats (effect blocks, ability target conventions,
 * IDS-derived lookups). Format-specific tables (header flags / item type /
 * spell type / etc.) live in `<format>/types.ts`.
 */

/** Bytes consumed by one feature-block (effect) record. */
export const EFFECT_SIZE = 0x30;

/** Element-wise equality for two byte sequences. */
export function bytesEqual(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// -- Effect (feature_block) lookups -----------------------------------------

/**
 * Effect target type (feature_block.target). Mostly drives "who does this
 * effect apply to" semantics inside the engine.
 */
export const EffectTarget: Record<number, string> = {
    0: "None",
    1: "Self",
    2: "Projectile target",
    3: "Party",
    4: "Everyone",
    5: "Everyone except party",
    6: "Caster group",
    7: "Target group",
    8: "Everyone except self",
    9: "Original caster",
};

/** Effect timing mode (feature_block.timing). */
export const EffectTiming: Record<number, string> = {
    0: "Instant/Limited",
    1: "Instant/Permanent",
    2: "Instant/While equipped",
    3: "Delay/Limited",
    4: "Delay/Permanent",
    5: "Delay/While equipped",
    6: "Limited after duration",
    7: "Permanent after duration",
    8: "Equipped after duration",
    9: "Instant/Permanent (after Death)",
    10: "Instant/Limited (10)",
    4096: "Absolute duration",
};

/** Effect dispel/resistance flags (feature_block.resistance). Bitfield. */
export const EffectResistanceFlags: Record<number, string> = {
    0x01: "Can be dispelled / Magic-resistance applies",
    0x02: "Ignores magic resistance (combine with bit 0)",
};

/** Effect saving-throw type flags (feature_block.saveType). Bitfield. */
export const EffectSaveTypeFlags: Record<number, string> = {
    0x00000001: "Spells",
    0x00000002: "Breath",
    0x00000004: "Paralyze / Poison / Death",
    0x00000008: "Wands",
    0x00000010: "Petrify / Polymorph",
    0x00000400: "Ignore primary target (EE)",
    0x00000800: "Ignore secondary target (EE)",
    0x01000000: "Bypass mirror image (EE/TobEx)",
    0x02000000: "Ignore difficulty / Limit stacking (EE/ToBEx)",
};

/**
 * EFF v2 effect `parentResourceFlags` (dword bitfield - the flags of the parent SPL that applied the effect).
 * EFF v2 only; the 48-byte feature block has no parent-resource fields. Bit positions per IESDP eff_v2/body
 * (these are NOT the same layout as the SPL header `flags` field - `SplFlags` - despite naming some of the same
 * concepts, so this is a distinct table).
 */
export const EffectParentResourceFlags: Record<number, string> = {
    0x00000400: "Hostile",
    0x00000800: "No LOS required",
    0x00001000: "Allow spotting",
    0x00002000: "Outdoors only",
    0x00004000: "Non-magical ability",
    0x00008000: "Ignore Wild Surge",
    0x00010000: "Non-combat ability",
};

/**
 * EFF v2 effect `parentResourceType` (the kind of resource that applied the effect). EFF v2 only; the 48-byte
 * feature block has no parent-resource fields. Values per IESDP eff_v2/body (0x90): 0 None, 1 Spell, 2 Item.
 */
export const EffectParentResourceType: Record<number, string> = {
    0: "None",
    1: "Spell",
    2: "Item",
};

// -- Classification lookups (shared across SPL/ITM/EFF) ---------------------

/**
 * Primary type / magic school (`mschool.2da`; `school.2da` in IWD). Shared by the SPL header `school`, the ITM
 * ability `primaryType`, and the EFF v2 effect `school` - all reference the same 2DA, so one table serves them.
 * Mod-extensible (up to 256 rows), so callers mark the field `enumOpen`. Number-keyed, so it works for either
 * the u8 (SPL/ITM) or u32 (EFF) wire width.
 */
export const Schools: Readonly<Record<number, string>> = {
    0: "None",
    1: "Abjurer",
    2: "Conjurer",
    3: "Diviner",
    4: "Enchanter",
    5: "Illusionist",
    6: "Invoker",
    7: "Necromancer",
    8: "Transmuter",
    9: "Generalist",
};

/**
 * Secondary type (`msectype.2da`). Shared by the SPL header `sectype`, the ITM ability `secondaryType`, and the
 * EFF v2 effect `sectype`. Mod-extensible, so callers mark the field `enumOpen`. Labels humanize the 2DA's
 * CamelCase identifiers.
 */
export const SecondaryTypes: Readonly<Record<number, string>> = {
    0: "None",
    1: "Spell Protections",
    2: "Specific Protections",
    3: "Illusionary Protections",
    4: "Magic Attack",
    5: "Divination Attack",
    6: "Conjuration",
    7: "Combat Protections",
    8: "Contingency",
    9: "Battleground",
    10: "Offensive Damage",
    11: "Disabling",
    12: "Combination",
    13: "Non-combat",
};

// -- Ability lookups (overlap between ITM and SPL ability shapes) -----------

/**
 * Ability target type - semantically shared between ITM `target` and SPL
 * `target`, though the value sets differ slightly. Common entries listed
 * here; format-specific extras can be added at the call site.
 */
export const AbilityTargetType: Record<number, string> = {
    0: "Invalid",
    1: "Living actor",
    2: "Inventory",
    3: "Dead actor",
    4: "Any point within range",
    5: "Caster",
    6: "Crash",
    7: "Caster (EE, instant)",
};

/** Ability `idRequired` (ITM) / `friendly` (SPL) bit flags. */
export const AbilityIdRequiredFlags: Record<number, string> = {
    0x01: "ID Required",
    0x02: "Non-ID Required",
};
