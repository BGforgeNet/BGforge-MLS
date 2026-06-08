// Hand-written from IESDP file_formats/ie_formats/cre_v1.htm (BG1 / BG2 / BGEE shape).
// PSTEE re-uses some byte ranges with different semantics; the layout below
// preserves byte-exact round-trip for all engines via opaque or generic
// representations of those overlapping ranges.

import { i16, i32, i8, u16, u32, u8 } from "typed-binary";
import { arraySpec, charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const creHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    // Strrefs into dialog.tlk: signed, -1 = "no string". (IESDP/the generator map strref -> i32; CRE is
    // hand-written here, so the signed codec is set directly.)
    longName: { codec: i32 },
    shortName: { codec: i32 },
    creatureFlags: { codec: u32 },
    xpForKilling: { codec: u32 },
    powerLevelOrXp: { codec: u32 },
    goldCarried: { codec: u32 },
    statusFlags: { codec: u32 },
    currentHp: { codec: u16 },
    maxHp: { codec: u16 },
    animationId: { codec: u32 },
    metalColor: { codec: u8 },
    minorColor: { codec: u8 },
    majorColor: { codec: u8 },
    skinColor: { codec: u8 },
    leatherColor: { codec: u8 },
    armorColor: { codec: u8 },
    hairColor: { codec: u8 },
    effStructureVersion: { codec: u8 },
    smallPortrait: charsSpec(8),
    largePortrait: charsSpec(8),
    reputation: { codec: i8 },
    hideInShadows: { codec: u8 },
    acNatural: { codec: i16 },
    acEffective: { codec: i16 },
    acCrushingMod: { codec: i16 },
    acMissileMod: { codec: i16 },
    acPiercingMod: { codec: i16 },
    acSlashingMod: { codec: i16 },
    thaco: { codec: u8 },
    numAttacks: { codec: u8 },
    saveVsDeath: { codec: u8 },
    saveVsWands: { codec: u8 },
    saveVsPolymorph: { codec: u8 },
    saveVsBreath: { codec: u8 },
    saveVsSpells: { codec: u8 },
    resistFire: { codec: u8 },
    resistCold: { codec: u8 },
    resistElectricity: { codec: u8 },
    resistAcid: { codec: u8 },
    resistMagic: { codec: u8 },
    resistMagicFire: { codec: u8 },
    resistMagicCold: { codec: u8 },
    resistSlashing: { codec: u8 },
    resistCrushing: { codec: u8 },
    resistPiercing: { codec: u8 },
    resistMissile: { codec: u8 },
    detectIllusion: { codec: u8 },
    setTraps: { codec: u8 },
    lore: { codec: u8 },
    lockpicking: { codec: u8 },
    moveSilently: { codec: u8 },
    findDisarmTraps: { codec: u8 },
    pickPockets: { codec: u8 },
    fatigue: { codec: u8 },
    intoxication: { codec: u8 },
    luck: { codec: u8 },
    /**
     * Weapon proficiencies: 20 bytes (IESDP cre_v1.htm 0x006e-0x0081). BG1 names the first 8 (large swords,
     * small swords, bows, spears, blunt, spiked, axe, missile); the rest are unused in BG1/BG2 (EE computes
     * them from KIT.IDS / WEAPPROF.2DA at runtime). Each byte packs an active-class value (bits 0-2) and an
     * original-class value (bits 3-5); kept as raw bytes here. Round-trips byte-identically regardless.
     */
    proficiencies: arraySpec({
        element: { codec: u8 },
        count: 20,
    }),
    // Turn-undead level (paladin/cleric) and the ranger tracking skill (0-100). IESDP cre_v1.htm 0x0082 / 0x0083;
    // previously absorbed into the 22-byte proficiencies block, now named so the editor can surface them.
    turnUndeadLevel: { codec: u8 },
    trackingSkill: { codec: u8 },
    /**
     * 32 bytes. BG1 / BG2 / BGEE: tracking-target resref-like string. PSTEE
     * reinterprets the same range as several distinct fields (thief / mage
     * class XP, increment vars, faction, team, species, shield flags,
     * attribute flags, reserved). We keep the BG / BGEE shape; PSTEE files
     * still round-trip byte-identically through the chars32 surface.
     */
    trackingTarget: charsSpec(32),
    /**
     * 100 strrefs covering the sound-set entries (SOUNDOFF.IDS / SNDSLOT.IDS).
     */
    soundSlots: arraySpec({
        element: { codec: u32 },
        count: 100,
    }),
    levelFirstClass: { codec: u8 },
    levelSecondClass: { codec: u8 },
    levelThirdClass: { codec: u8 },
    sex: { codec: u8 },
    strength: { codec: u8 },
    strengthBonus: { codec: u8 },
    intelligence: { codec: u8 },
    wisdom: { codec: u8 },
    dexterity: { codec: u8 },
    constitution: { codec: u8 },
    charisma: { codec: u8 },
    morale: { codec: u8 },
    moraleBreak: { codec: u8 },
    racialEnemy: { codec: u8 },
    moraleRecoveryTime: { codec: u16 },
    /**
     * Kit information (KIT.IDS). Read as a little-endian u32; the value matches the IESDP "KIT_*" dword
     * hex directly - the Edwin fixture stores `00 00 80 00` -> 0x00800000 = Conjurer, and Edwin is a
     * Conjurer, so no byte-swap is needed. The named-kit lookup + dropdown are applied in
     * `header.overrides.ts` (CreKit). IESDP's "big endian" note does not hold here: the LE read matches
     * KIT.IDS across the vendored CRE v1 corpus, including 34 warrior-range kits a big-endian read garbles.
     */
    kit: { codec: u32 },
    scriptOverride: charsSpec(8),
    scriptClass: charsSpec(8),
    scriptRace: charsSpec(8),
    scriptGeneral: charsSpec(8),
    scriptDefault: charsSpec(8),
    enemyAlly: { codec: u8 },
    general: { codec: u8 },
    race: { codec: u8 },
    class: { codec: u8 },
    specific: { codec: u8 },
    gender: { codec: u8 },
    /**
     * OBJECT.IDS references. The engine uses the five bytes as a single
     * ordered tuple of identifier IDs (one per byte slot). Slots that no
     * longer match a referenced object stay zero.
     */
    objectRefs: arraySpec({
        element: { codec: u8 },
        count: 5,
    }),
    alignment: { codec: u8 },
    // Actor enumeration values, set at runtime; 0xFFFF (-1) is the "unassigned" sentinel, so signed.
    globalActorEnum: { codec: i16 },
    localActorEnum: { codec: i16 },
    deathVariable: charsSpec(32),
    knownSpellsOffset: { codec: u32 },
    knownSpellsCount: { codec: u32 },
    spellMemInfoOffset: { codec: u32 },
    spellMemInfoCount: { codec: u32 },
    memorizedSpellsOffset: { codec: u32 },
    memorizedSpellsCount: { codec: u32 },
    itemSlotsOffset: { codec: u32 },
    itemsOffset: { codec: u32 },
    itemsCount: { codec: u32 },
    effectsOffset: { codec: u32 },
    effectsCount: { codec: u32 },
    dialogFile: charsSpec(8),
} satisfies Record<string, FieldSpec>;

export type CreHeaderData = SpecData<typeof creHeaderSpec>;
