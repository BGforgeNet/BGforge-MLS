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
    0x01000000: "Bypass mirror image (EE/ToBEx)",
    0x02000000: "Ignore difficulty (EE) / Limit stacking (ToBEx)",
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

/**
 * Every effect resource field: the opcode chooses what the resref points at, so no one type is right for the
 * field (IESDP has opcode 135 pointing at a creature, 146 at a spell, 214 at a 2DA). Declared rather than left
 * bare so the absence reads as a decision, and shared so the EFF v2 body and the 48-byte feature block agree.
 *
 * The relationship overlay resolves it per record from the opcode's own IESDP page, for the opcodes whose
 * pages agree on one target type; this stays the spec-level answer, which cannot see the sibling opcode.
 */
export const EFFECT_RESOURCE_REF = {
    kind: "deferred",
    reason: "Target type is chosen by the effect's opcode",
} as const;

// -- Classification lookups (shared across SPL/ITM/EFF) ---------------------

/**
 * The 2DA each classification field is named by, declared once so the SPL header, ITM ability and EFF body
 * sites cannot drift apart - all three read the same table, and a field named in one editor but not another
 * would be the drift this prevents.
 */
export const SCHOOL_REF = { kind: "2da", tables: ["MSCHOOL"] } as const;
export const SECTYPE_REF = { kind: "2da", tables: ["MSECTYPE"] } as const;

/**
 * The projectile an ABILITY fires - the ITM ability's `projectileAnimation` and the SPL ability's
 * `projectile`. One engine concept across the two formats, so one declaration, for the same reason the
 * school/sectype pair shares one. The EFF v2 body's projectile field is NOT this one despite IESDP's
 * projectl.ids page listing all three offsets together - see `IMPACT_PROJECTILE_REF`.
 *
 * TWO tables, and they are NOT peers. PROJECTL.IDS is the real one and leads: it is the game's own
 * projectile index, its symbols are `.PRO` resource basenames (171 of 171 resolve to a real `.PRO` on
 * BG2:ToB, 238 of 272 on BG:EE), and the stored value is its key PLUS ONE. MISSILE.IDS is a label
 * convenience with nothing behind it - IESDP's own missile.ids page: "Nothing in-game is linked to
 * MISSILE.IDS, it's just for user-friendly labels, and is only used by WeiDU/NearInfinity. The game only
 * uses PROJECTL.IDS but for most purposes adds 1 to index [...] you can wipe out the entirety of
 * MISSILE.IDS and the game won't care." Neither table is named by any action or trigger signature, in
 * either install's `action.ids`/`trigger.ids` - these are file-format symbol tables, not script types.
 *
 * MISSILE still earns second place rather than none, for two things PROJECTL structurally cannot do: name a
 * stored 1 (PROJECTL's keys start at 1, so a stored 1 would need its key 0, which does not exist) - and that
 * is 2292 of 3537 BG:EE spell abilities - and cover the keys a sparse install omits. BG:EE ships a full
 * 365-entry MISSILE.IDS while BG2 classic ships a 29-entry stub of it beside a full 171-entry PROJECTL.IDS,
 * so the candidates merge rather than the first present winning outright; ordering only decides who wins a
 * key both name, never how many values get named.
 *
 * "For most purposes adds 1" is the caveat that makes `IMPACT_PROJECTILE_REF` a separate declaration - the
 * EFF v2 field is one of the purposes it does not.
 *
 * The projectiles themselves are NOT vendored, as with CRE `animationId`: that value space is per-install and
 * mod-extended, so a vendored copy would pose as a closed list. `AbilityProjectileNone` is the exception that
 * proves it - only the values no table can reach - see there.
 */
export const PROJECTILE_REF = {
    kind: "ids",
    tables: ["PROJECTL", "MISSILE"],
    keyEncoding: { PROJECTL: "keyPlusOne" },
    symbolResource: { table: "PROJECTL", type: "PRO" },
} as const;

/**
 * The two ability-projectile values that name no projectile, vendored because no install table can supply them.
 *
 * This is not the closed list `PROJECTILE_REF` refuses to vendor: it holds only the values BELOW the tables'
 * key space, never a projectile, so it cannot go stale against an install or a mod.
 * - `0` is named by nothing. PROJECTL would need its key -1, and neither install's MISSILE.IDS has a key 0, so
 *   the value read bare even with a game open - 99 of BG2:ToB's 1845 item abilities store it. Near Infinity
 *   synthesises a label here for the same reason.
 * - `1` is PROJECTL's absent key 0, and it is the DOMINANT stored value (1529 of those 1845, 2300 of 3683 spell
 *   abilities). MISSILE.IDS names it `None` on both installs and wins per value where it ships - but it is the
 *   table an install may omit entirely, and the whole field would otherwise read bare without a game.
 *
 * Both read `None` because that is what each is: the value prefix the dropdown renders (`0 None` / `1 None`)
 * keeps them apart. `None` is the editor's own word for unset, as in `Schools` - not an invented identifier,
 * which the vendored-mirror rule forbids (`binary/src/AGENTS.md`).
 */
export const AbilityProjectileNone: Readonly<Record<number, string>> = {
    0: "None",
    1: "None",
};

/**
 * The EFF v2 body's projectile (0xA0) - the projectile spawned on IMPACT, not the one an ability launches, and
 * keyed DIRECTLY by PROJECTL.IDS with no MISSILE candidate and no offset.
 *
 * A separate declaration from `PROJECTILE_REF` on purpose. IESDP's projectl.ids page lists this offset beside
 * the ITM and SPL ones, which invites treating all three as one field; they are not. Near Infinity reads the
 * ability fields through a missile-aware lookup that maps a stored key to PROJECTL key minus one, and reads
 * THIS field as a plain PROJECTL.IDS entry - and names it "Impact projectile" rather than reusing the ability
 * label. IESDP states the off-by-one only for the ability fields, which agrees.
 *
 * The corpus cannot arbitrate: the field is 0 in all 1053 EFF records across a real BG:EE and BG2:ToB install.
 * So this rests on the two documentary sources agreeing, not on measurement - a populated record contradicting
 * them would be reason to revisit.
 */
export const IMPACT_PROJECTILE_REF = {
    kind: "ids",
    tables: ["PROJECTL"],
    symbolResource: { table: "PROJECTL", type: "PRO" },
} as const;

/**
 * The one impact-projectile value that names no projectile. Same reasoning as `AbilityProjectileNone` - vendor
 * only what is below the table's key space - applied to a field with ONE directly-keyed table.
 *
 * PROJECTL.IDS starts at key 1 on both a real BG:EE (272 entries) and BG2:ToB (171), so a stored 0 names nothing
 * even with a game open, and that is every one of the 1053 EFF records both installs ship.
 *
 * Deliberately NOT `AbilityProjectileNone`, which the near-identical shape invites. The ability fields store
 * PROJECTL's key plus one, so their 1 is the table's absent key 0 and unset; this field is keyed directly, so
 * its 1 is PROJECTL's ARROW. Merging the two tables would relabel a real projectile as "None" here.
 */
export const ImpactProjectileNone: Readonly<Record<number, string>> = {
    0: "None",
};

/**
 * Primary type / magic school (`mschool.2da`; `school.2da` in IWD). Shared by the SPL header `school`, the ITM
 * ability `primaryType`, and the EFF v2 effect `school` - all reference the same 2DA, so one table serves them.
 * Mod-extensible (up to 256 rows), so callers mark the field `enumOpen`. Number-keyed, so it works for either
 * the u8 (SPL/ITM) or u32 (EFF) wire width. Labels are the 2DA's own row names verbatim; `0` has no row, so it
 * keeps the editor's word for unset.
 * 2DA reference: https://iesdp.bgforge.net/files/2da/2da_bgee/mschool.htm
 */
export const Schools: Readonly<Record<number, string>> = {
    0: "None",
    1: "ABJURER",
    2: "CONJURER",
    3: "DIVINER",
    4: "ENCHANTER",
    5: "ILLUSIONIST",
    6: "INVOKER",
    7: "NECROMANCER",
    8: "TRANSMUTER",
    9: "GENERALIST",
};

/**
 * Secondary type (`msectype.2da`). Shared by the SPL header `sectype`, the ITM ability `secondaryType`, and the
 * EFF v2 effect `sectype`. Mod-extensible, so callers mark the field `enumOpen`. Labels are the 2DA's own row
 * names verbatim, so the field reads the same with or without a game open.
 * 2DA reference: https://iesdp.bgforge.net/files/2da/2da_bgee/msectype.htm
 */
export const SecondaryTypes: Readonly<Record<number, string>> = {
    0: "None",
    1: "SpellProtections",
    2: "SpecificProtections",
    3: "IllusionaryProtections",
    4: "MagicAttack",
    5: "DivinationAttack",
    6: "Conjuration",
    7: "CombatProtections",
    8: "Contingency",
    9: "Battleground",
    10: "OffensiveDamage",
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

/** ITM ability `idRequired` bit flags, shown under the "Identification" group legend (the ITM ability override
 *  relabels the group). SPL's analogous `friendly` field uses its own `SplAbilityFriendly` map. */
export const AbilityIdRequiredFlags: Record<number, string> = {
    0x01: "Required",
    0x02: "Not required",
};
