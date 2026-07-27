/**
 * Hand-written augmentation of `creHeaderSpec` with IESDP-derived lookups
 * and structural-field role annotations. Same shape as the IE counterparts
 * (`itm/specs/header.overrides.ts`, `spl/specs/header.overrides.ts`).
 */

import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { i32, u8 } from "typed-binary";
import {
    CreAlignment,
    CreClass,
    CreCreatureFlags,
    CreEffStructureVersion,
    CreEnemyAlly,
    CreGeneral,
    CreKit,
    CreRace,
    CreSex,
    CreSpecific,
    CreStatusFlags,
} from "../types";
import { creHeaderSpec } from "./header";

// Slot labels for the three real-data array fields that the display layer must
// render as individually-recoverable slots rather than an opaque "(N values)"
// padding summary. Keeping labels here avoids repeating them in the spec and
// in the rebuild helper that reads them back.

/** 100 sound-set strref slots per SOUNDOFF.IDS / SNDSLOT.IDS. */
const SOUND_SLOT_LABELS: readonly string[] = Array.from({ length: 100 }, (_, i) => `Sound ${i + 1}`);

/** 5 OBJECT.IDS identifier slots. */
const OBJECT_REF_LABELS: readonly string[] = Array.from({ length: 5 }, (_, i) => `Object ${i + 1}`);

export const creHeaderSpecAnnotated = {
    ...creHeaderSpec,
    creatureFlags: { ...creHeaderSpec.creatureFlags, flags: CreCreatureFlags },
    statusFlags: { ...creHeaderSpec.statusFlags, flags: CreStatusFlags },
    /**
     * `effStructureVersion` is closed: the engine literally branches on
     * 0 vs 1 to compute the per-effect record size, and the writer mirrors
     * that branch. Strict membership enforcement is correct here.
     */
    effStructureVersion: { ...creHeaderSpec.effStructureVersion, enum: CreEffStructureVersion },
    /**
     * `sex` is GENDER.IDS in BGEE, which mods can extend - the engine
     * tolerates out-of-table values. Keep advisory.
     */
    sex: { ...creHeaderSpec.sex, enum: CreSex, enumOpen: true },
    enemyAlly: { ...creHeaderSpec.enemyAlly, enum: CreEnemyAlly, enumOpen: true },
    general: { ...creHeaderSpec.general, enum: CreGeneral, enumOpen: true },
    // SPECIFIC.IDS: open enum, mostly game/mod-defined (see CreSpecific).
    specific: { ...creHeaderSpec.specific, enum: CreSpecific, enumOpen: true },
    race: { ...creHeaderSpec.race, enum: CreRace, enumOpen: true },
    // `racialEnemy` is a RACE.IDS value (the ranger favoured-enemy race) - same lookup table as `race`.
    racialEnemy: { ...creHeaderSpec.racialEnemy, enum: CreRace, enumOpen: true },
    class: { ...creHeaderSpec.class, enum: CreClass, enumOpen: true },
    // `gender` mirrors GENDER.IDS - same lookup table as `sex`.
    gender: { ...creHeaderSpec.gender, enum: CreSex, enumOpen: true },
    alignment: { ...creHeaderSpec.alignment, enum: CreAlignment, enumOpen: true },
    /**
     * `kit` is KIT.IDS (CRE header 0x244). Open enum: mods add kits beyond the engine-defined set, so
     * out-of-table values surface as Unknown(N). The LE u32 read matches the IESDP KIT_* dword values
     * directly (verified against the Edwin/Conjurer fixture - see CreKit).
     */
    kit: { ...creHeaderSpec.kit, enum: CreKit, enumOpen: true },
    // The 20 weapon-proficiency bytes are split into 40 packed scalar fields in the base spec (each byte ->
    // active/original sub-values per IESDP cre_v1.htm); they pass through here with no per-field overrides and
    // are surfaced as a 2-column matrix by the layout.
    /**
     * Sound-set strref block (100 x u32). Each entry is a sound-set strref
     * index per SOUNDOFF.IDS / SNDSLOT.IDS. Slots view makes each value
     * recoverable from the display tree.
     */
    soundSlots: arraySpec({
        // Sound-set strrefs into dialog.tlk: signed, -1 = "no sound" (the common value for unused slots).
        element: { codec: i32, strref: true },
        count: 100,
        view: "slots",
        slotLabels: SOUND_SLOT_LABELS,
    }),
    /**
     * OBJECT.IDS reference block (5 x u8). The engine uses these as an ordered
     * tuple of identifier IDs. Slots view makes each byte recoverable.
     */
    objectRefs: arraySpec({
        element: { codec: u8 },
        count: 5,
        view: "slots",
        slotLabels: OBJECT_REF_LABELS,
    }),
    /**
     * Structural pointers / counts into the five variable-length sections
     * and the fixed item-slot block. The writer recomputes them from
     * `ctx.sectionOffsets` / `ctx.arrays` so users cannot desync the
     * header by hand-editing the JSON snapshot.
     */
    knownSpellsOffset: {
        ...creHeaderSpec.knownSpellsOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "knownSpells" } as const,
    },
    knownSpellsCount: {
        ...creHeaderSpec.knownSpellsCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "knownSpells" } as const,
    },
    spellMemInfoOffset: {
        ...creHeaderSpec.spellMemInfoOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "spellMemInfo" } as const,
    },
    spellMemInfoCount: {
        ...creHeaderSpec.spellMemInfoCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "spellMemInfo" } as const,
    },
    memorizedSpellsOffset: {
        ...creHeaderSpec.memorizedSpellsOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "memorizedSpells" } as const,
    },
    memorizedSpellsCount: {
        ...creHeaderSpec.memorizedSpellsCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "memorizedSpells" } as const,
    },
    itemSlotsOffset: {
        ...creHeaderSpec.itemSlotsOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "itemSlots" } as const,
    },
    itemsOffset: {
        ...creHeaderSpec.itemsOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "items" } as const,
    },
    itemsCount: {
        ...creHeaderSpec.itemsCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "items" } as const,
    },
    effectsOffset: {
        ...creHeaderSpec.effectsOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "effects" } as const,
    },
    effectsCount: {
        ...creHeaderSpec.effectsCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "effects" } as const,
    },
} satisfies Record<string, FieldSpec>;

/**
 * Header presentation overrides for the packed bitfield enums - rendered in hex so the value reads as the
 * bitfield it is rather than a meaningless decimal (the prefix width follows the field's byte size):
 *  - `kit` is a packed KIT.IDS dword (0x00800000 = Conjurer, 0x40010000 = Berserker) -> "0x00800000".
 *  - `alignment` is a packed ALIGNMEN.IDS byte: high nibble law-axis, low nibble morality (0x13 = lawful
 *    evil) -> "0x13", not the structure-hiding "19".
 * Shared by the field walk (`cre/index.ts`) and the derived presentation schema so both agree.
 */
export const creHeaderPresentation: StructPresentation<SpecData<typeof creHeaderSpecAnnotated>> = {
    kit: { format: "hex32" },
    alignment: { format: "hex32" },
    // Animation ID hex directly names the animation resource (0x6004 -> 6004.INI) and maps to ANIMATE.IDS hex
    // constants; decimal (24580) is unrecognisable. Display-only - the codec and wire bytes are unchanged.
    animationId: { format: "hex32" },
};
