/**
 * Hand-written augmentation of `creHeaderSpec` with IESDP-derived lookups
 * and structural-field role annotations. Same shape as the IE counterparts
 * (`itm/specs/header.overrides.ts`, `spl/specs/header.overrides.ts`).
 */

import type { FieldSpec } from "../../spec/types";
import {
    CreAlignment,
    CreClass,
    CreCreatureFlags,
    CreEffStructureVersion,
    CreEnemyAlly,
    CreGeneral,
    CreRace,
    CreSex,
    CreStatusFlags,
} from "../types";
import { creHeaderSpec } from "./header";

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
    race: { ...creHeaderSpec.race, enum: CreRace, enumOpen: true },
    class: { ...creHeaderSpec.class, enum: CreClass, enumOpen: true },
    // `gender` mirrors GENDER.IDS - same lookup table as `sex`.
    gender: { ...creHeaderSpec.gender, enum: CreSex, enumOpen: true },
    alignment: { ...creHeaderSpec.alignment, enum: CreAlignment, enumOpen: true },
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
