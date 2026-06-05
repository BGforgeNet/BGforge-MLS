/**
 * Generalized IE structure-op byte-builders for the ability+effects formats
 * (ITM, SPL), produced by a per-format factory.
 *
 * Approach: zero-construct from the spec shape (approach A). The shared default
 * effect (defaultIeEffect) assigns each field its natural zero/empty value based
 * on its SpecData projection:
 * - scalar without flags -> 0
 * - scalar with flags -> [] (empty flag array; encodes to wire value 0)
 * - chars field -> "" (NUL-padded to the byte budget on write)
 * - fixed-count array -> number[] of the declared length, all zeros
 * This keeps the default independent of any fixture - no fixture byte leaks into
 * the default. The per-format default ability is injected by the caller (its
 * field set differs per format).
 *
 * The EntryCollection descriptors set no relink hook; cross-reference
 * maintenance (the per-ability effect-range start/count) lives in the
 * byte-builders, which relink via relinkAbilityEffectIndices (ability ops) or
 * shiftEffectRefs (effect ops) after each mutation. The two relink strategies
 * are not interchangeable: ability ops move whole effect SLICES (running-offset
 * re-derivation is the slice-correct relink), effect ops are single-position
 * count adjusts around one edit point (owner-aware surgical shift).
 *
 * Every effect-range field read/write is parameterized through IeEffectRangeFields
 * and the guarded readNum accessor (see effect-partition.ts), so one body serves
 * ITM and SPL; the format-specific dependencies (canonical doc accessor,
 * canonical serializer, default ability/effect factories) are injected via the
 * factory config.
 */

import { applyEntryMutation, type EntryCollection } from "../spec/entity-ops";
import { createEffectPartition, readNum, type EffectOwner, type IeEffectRangeFields } from "./effect-partition";
import type { effectSpecAnnotated } from "./specs/effect.overrides";
import type { SpecData } from "../spec/types";
import type { ParseResult } from "../types";

/** Display-tree section names - identical for every IE ability+effects format (see ability-effects-parser.ts). */
export const ABILITIES_SECTION = "Abilities";
export const EFFECTS_SECTION = "Effects";
const ABILITY_LABEL_PREFIX = "Ability ";
const EFFECT_LABEL_PREFIX = "Effect ";

/** The shared effect element type (ITM and SPL both use ie-common/specs/effect). */
export type IeEffect = SpecData<typeof effectSpecAnnotated>;

/** A valid default effect (opcode 0 = "None"), all fields zero/empty. Shared by every IE ability+effects format. */
export function defaultIeEffect(): IeEffect {
    return {
        opcode: 0,
        target: 0,
        power: 0,
        parameter1: 0,
        parameter2: 0,
        timing: 0,
        resistance: [], // flags field; [] encodes to wire 0
        duration: 0,
        probability1: 0,
        probability2: 0,
        resource: "", // chars(8); NUL-padded to 8 bytes on write
        maxLevel: 0,
        minLevel: 0,
        saveType: [], // flags field; [] encodes to wire 0
        saveBonus: 0,
        stackingIdEx: 0,
    };
}

export interface IeStructureOpsConfig<Doc, Ability> {
    readonly fields: IeEffectRangeFields;
    /** getXxxCanonicalDocument(pr) ?? rebuildXxxCanonicalDocument(pr). */
    readonly readDocument: (parseResult: ParseResult) => Doc | undefined;
    /** serializeXxxCanonicalDocument - the format's canonical writer. */
    readonly serialize: (doc: Doc) => Uint8Array;
    readonly defaultAbility: () => Ability;
    readonly defaultEffect: () => IeEffect;
}

export interface IeStructureOps<Doc, Ability> {
    readonly abilitiesCollection: EntryCollection<Doc, Ability>;
    readonly effectsCollection: EntryCollection<Doc, IeEffect>;
    readonly relinkAbilityEffectIndices: (doc: Doc) => Doc;
    readonly buildAddAbilityBytes: (pr: ParseResult, arrayPath: readonly string[]) => Uint8Array | undefined;
    readonly buildInsertAbilityBytes: (
        pr: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ) => Uint8Array | undefined;
    readonly buildRemoveAbilityBytes: (pr: ParseResult, entryPath: readonly string[]) => Uint8Array | undefined;
    readonly buildReorderAbilityBytes: (
        pr: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ) => Uint8Array | undefined;
    readonly buildDuplicateAbilityBytes: (pr: ParseResult, entryPath: readonly string[]) => Uint8Array | undefined;
    readonly buildRemoveEffectBytes: (pr: ParseResult, entryPath: readonly string[]) => Uint8Array | undefined;
    readonly buildInsertEffectBytes: (
        pr: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ) => Uint8Array | undefined;
    readonly buildDuplicateEffectBytes: (pr: ParseResult, entryPath: readonly string[]) => Uint8Array | undefined;
    readonly buildReorderEffectBytes: (
        pr: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ) => Uint8Array | undefined;
    readonly isListSection: (arrayPath: readonly string[]) => boolean;
    readonly isModifiableArray: (arrayPath: readonly string[]) => boolean;
    readonly isAddableArray: (arrayPath: readonly string[]) => boolean;
    readonly isRemovableEntry: (entryPath: readonly string[]) => boolean;
}

export function createIeStructureOps<
    Doc extends { header: Record<string, unknown>; abilities: Ability[]; effects: IeEffect[] },
    Ability extends Record<string, unknown>,
>(config: IeStructureOpsConfig<Doc, Ability>): IeStructureOps<Doc, Ability> {
    const { fields, readDocument, serialize, defaultAbility, defaultEffect } = config;
    const partition = createEffectPartition<Doc["header"], Ability>(fields);
    const { effectOwners, validateEffectPartition, shiftEffectRefs } = partition;

    /**
     * Re-derive the running-offset ability effect-range starts, reattaching the result onto the concrete Doc type.
     *
     * The partition factory's relinkAbilityEffectIndices is generic over header/ability but returns the structural
     * EffectPartitionDoc shape (effects widened to unknown[]); it only rewrites header + ability range starts and
     * passes effects through. Layering the rewritten header/abilities back onto the original doc recovers Doc without
     * a cast (same type-preservation trick as applyEffectShift below).
     */
    function relinkAbilityEffectIndices(doc: Doc): Doc {
        const relinked = partition.relinkAbilityEffectIndices(doc);
        return { ...doc, header: relinked.header, abilities: relinked.abilities };
    }

    /**
     * EntryCollection descriptor for abilities.
     *
     * read/write operate on the document-level abilities array. addable and
     * removable are both true because abilities are a standalone ordered list. This
     * descriptor sets no relink hook: the cross-reference maintenance (the per-ability
     * effect-range start/count) lives in the byte-builders below, which re-derive the
     * indices via relinkAbilityEffectIndices after each array mutation.
     */
    const abilitiesCollection: EntryCollection<Doc, Ability> = {
        read: (doc) => doc.abilities,
        write: (doc, next) => ({ ...doc, abilities: [...next] }),
        defaultElement: defaultAbility,
        addable: true,
        removable: true,
        // No relink hook: the byte-builders re-derive the ability effect-range start/count via relinkAbilityEffectIndices.
    };

    /**
     * EntryCollection descriptor for effects.
     *
     * addable is false because a new effect has no unambiguous owner: callers
     * would not know which ability's effect-range start/count to update without
     * additional context. Effects are instead created via insert-relative to an
     * existing effect, which inherits that effect's owner. removable is true. This
     * descriptor sets no relink hook: the effect byte-builders below shift the
     * owning range's index/count surgically via shiftEffectRefs after each edit.
     */
    const effectsCollection: EntryCollection<Doc, IeEffect> = {
        read: (doc) => doc.effects,
        write: (doc, next) => ({ ...doc, effects: [...next] }),
        defaultElement: defaultEffect,
        addable: false, // owner-ambiguous: a bare add has no owning range to attribute the effect to
        removable: true,
        // No relink hook: the effect byte-builders shift the owning range via shiftEffectRefs.
    };

    /**
     * Resolve a 0-based ability index from an entry path like ["Abilities", "Ability N"].
     * The display tree labels abilities 1-based ("Ability 1" is abilities[0]), per
     * ie-common/ability-effects-parser.ts. Returns undefined for any path that is
     * not an in-range ability address.
     */
    function resolveAbilityIndex(entryPath: readonly string[], abilityCount: number): number | undefined {
        if (entryPath.length !== 2 || entryPath[0] !== ABILITIES_SECTION) return undefined;
        const label = entryPath[1];
        if (label === undefined || !label.startsWith(ABILITY_LABEL_PREFIX)) return undefined;
        const oneBased = Number.parseInt(label.slice(ABILITY_LABEL_PREFIX.length), 10);
        if (!Number.isInteger(oneBased)) return undefined;
        const index = oneBased - 1;
        if (index < 0 || index >= abilityCount) return undefined;
        return index;
    }

    /**
     * Resolve a 0-based effect index from an entry path like ["Effects", "Effect N"].
     * The display tree labels effects 1-based ("Effect 1" is effects[0]), per
     * ie-common/ability-effects-parser.ts. Returns undefined for any path that is
     * not an in-range effect address.
     */
    function resolveEffectIndex(entryPath: readonly string[], effectCount: number): number | undefined {
        if (entryPath.length !== 2 || entryPath[0] !== EFFECTS_SECTION) return undefined;
        const label = entryPath[1];
        if (label === undefined || !label.startsWith(EFFECT_LABEL_PREFIX)) return undefined;
        const oneBased = Number.parseInt(label.slice(EFFECT_LABEL_PREFIX.length), 10);
        if (!Number.isInteger(oneBased)) return undefined;
        const index = oneBased - 1;
        if (index < 0 || index >= effectCount) return undefined;
        return index;
    }

    /** The pre-edit effect slice an ability owns, read from the ORIGINAL doc. */
    function abilitySlice(doc: Doc, index: number): { start: number; count: number } {
        // Non-null is safe: every caller resolves `index` through resolveAbilityIndex, which returns
        // undefined for any out-of-range slot; reorder's lo/hi both derive from that resolved index.
        const ability = doc.abilities[index]!;
        return { start: readNum(ability, fields.abilityStart), count: readNum(ability, fields.abilityCount) };
    }

    function cloneEffects(effects: readonly IeEffect[]): IeEffect[] {
        // structuredClone gives an independent deep copy so a duplicated slice does
        // not alias the source (flags arrays / nested fields stay distinct).
        return effects.map((effect) => structuredClone(effect));
    }

    /**
     * Validate the effect partition of an already-relinked doc, then serialize. A
     * non-empty issue list means the edit left the ranges inconsistent - throw
     * rather than emit a corrupt file, since this module is the sole guard for
     * per-ability effect ranges. Effect ops call this directly: they relink the
     * ranges surgically via shiftEffectRefs before splicing, so re-deriving the
     * ability indices (as finalizeAndSerialize does) would clobber a just-applied
     * equipping or cross-owner shift.
     */
    function serializeWithValidation(doc: Doc): Uint8Array {
        const issues = validateEffectPartition(doc);
        if (issues.length > 0) {
            throw new Error(`IE structure-op produced an inconsistent effect partition: ${issues.join("; ")}`);
        }
        return serialize(doc);
    }

    /**
     * Finalize a structural ABILITY edit: re-derive the running-offset indices, then
     * validate and serialize. Ability ops move whole effect SLICES, so the
     * running-offset re-derivation (not a surgical shift) is the slice-correct
     * relink; see relinkAbilityEffectIndices.
     */
    function finalizeAndSerialize(doc: Doc): Uint8Array {
        return serializeWithValidation(relinkAbilityEffectIndices(doc));
    }

    /** Append a new empty-slice ability. effects[] is unchanged. */
    function buildAddAbilityBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        if (arrayPath.length !== 1 || arrayPath[0] !== ABILITIES_SECTION) return undefined;
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const mutation = applyEntryMutation(doc.abilities, "add", doc.abilities.length, defaultAbility);
        if (!mutation) return undefined;
        return finalizeAndSerialize({ ...doc, abilities: [...mutation.next] });
    }

    /** Insert a new empty-slice ability before/after the targeted slot. effects[] is unchanged. */
    function buildInsertAbilityBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveAbilityIndex(entryPath, doc.abilities.length);
        if (index === undefined) return undefined;
        const mutation = applyEntryMutation(doc.abilities, "insert", index, defaultAbility, position);
        if (!mutation) return undefined;
        return finalizeAndSerialize({ ...doc, abilities: [...mutation.next] });
    }

    /** Remove the targeted ability AND its owned effect slice. */
    function buildRemoveAbilityBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveAbilityIndex(entryPath, doc.abilities.length);
        if (index === undefined) return undefined;
        const mutation = applyEntryMutation(doc.abilities, "remove", index, defaultAbility);
        if (!mutation) return undefined;

        const { start, count } = abilitySlice(doc, index);
        const effects = [...doc.effects.slice(0, start), ...doc.effects.slice(start + count)];
        return finalizeAndSerialize({ ...doc, abilities: [...mutation.next], effects });
    }

    /**
     * Reorder the targeted ability up/down by one, swapping the two adjacent ability
     * records AND their two adjacent effect slices so each ability still owns a
     * contiguous slice after the running-offset relink.
     */
    function buildReorderAbilityBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveAbilityIndex(entryPath, doc.abilities.length);
        if (index === undefined) return undefined;
        const mutation = applyEntryMutation(doc.abilities, "reorder", index, defaultAbility, undefined, direction);
        if (!mutation) return undefined; // boundary no-op

        // The two slots being swapped, in ascending order: lo precedes hi in effects[].
        const lo = Math.min(index, mutation.index);
        const hi = Math.max(index, mutation.index);
        const loSlice = abilitySlice(doc, lo);
        const hiSlice = abilitySlice(doc, hi);
        // Swap the two adjacent slices: [..before lo][hi slice][lo slice][..after hi].
        const effects = [
            ...doc.effects.slice(0, loSlice.start),
            ...doc.effects.slice(hiSlice.start, hiSlice.start + hiSlice.count),
            ...doc.effects.slice(loSlice.start, loSlice.start + loSlice.count),
            ...doc.effects.slice(hiSlice.start + hiSlice.count),
        ];
        return finalizeAndSerialize({ ...doc, abilities: [...mutation.next], effects });
    }

    /**
     * Duplicate the targeted ability: clone the record (inserted right after the
     * source) AND clone its effect slice (inserted right after the source slice, at
     * start + count) so the clone owns an independent contiguous slice.
     */
    function buildDuplicateAbilityBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveAbilityIndex(entryPath, doc.abilities.length);
        if (index === undefined) return undefined;
        const mutation = applyEntryMutation(doc.abilities, "duplicate", index, defaultAbility);
        if (!mutation) return undefined;

        const { start, count } = abilitySlice(doc, index);
        const clonedSlice = cloneEffects(doc.effects.slice(start, start + count));
        const effects = [...doc.effects.slice(0, start + count), ...clonedSlice, ...doc.effects.slice(start + count)];
        return finalizeAndSerialize({ ...doc, abilities: [...mutation.next], effects });
    }

    /**
     * Apply a surgical range shift then reattach the caller's typed effects array.
     *
     * shiftEffectRefs is generic over the header/ability types but widens `effects`
     * to `unknown[]` (it only relinks the index/count references and passes effects
     * through untouched). It is fed the PRE-splice doc so the owner's pre-edit range
     * is what shiftEffectRefs validates `at` against; the post-splice typed effects
     * are then layered back on, recovering the concrete Doc type without a cast.
     */
    function applyEffectShift(
        doc: Doc,
        nextEffects: IeEffect[],
        args: { at: number; delta: number; owner: EffectOwner },
    ): Doc {
        const shifted = shiftEffectRefs(doc, args);
        return { ...doc, header: shifted.header, abilities: shifted.abilities, effects: nextEffects };
    }

    /**
     * Resolve the owner of a target effect index. Non-null is safe: callers gate on
     * resolveEffectIndex which returns undefined for any out-of-range index, and a
     * real IE partition covers every index, so effectOwners[effIdx] is populated.
     * If a hand-edited orphan slips through, this surfaces as a throw that fails the
     * structure-op rather than silently misattributing the edit.
     */
    function effectOwnerAt(doc: Doc, effectIndex: number): EffectOwner {
        const owner = effectOwners(doc)[effectIndex];
        if (owner === undefined) {
            throw new Error(`IE effect index ${effectIndex} has no owning range (orphan); cannot apply structure-op`);
        }
        return owner;
    }

    /**
     * Remove the targeted effect from its owning range. The owner's count drops by 1
     * and every later range shifts down by 1 (shiftEffectRefs); doc.effects loses the
     * one element at effIdx. The relink is owner-aware (it may be the equipping range
     * or an ability), unlike the ability ops' running-offset re-derivation.
     */
    function buildRemoveEffectBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const effIdx = resolveEffectIndex(entryPath, doc.effects.length);
        if (effIdx === undefined) return undefined;

        const owner = effectOwnerAt(doc, effIdx);
        const effects = [...doc.effects.slice(0, effIdx), ...doc.effects.slice(effIdx + 1)];
        return serializeWithValidation(applyEffectShift(doc, effects, { at: effIdx, delta: -1, owner }));
    }

    /**
     * Insert a new default effect before/after the targeted effect. The new effect
     * INHERITS the reference effect's owner: its count grows by 1 and later ranges
     * shift up by 1. "before" inserts at effIdx; "after" at effIdx+1, which for the
     * owner's last effect is the owner's inclusive end boundary (allowed by
     * shiftEffectRefs for inserts).
     */
    function buildInsertEffectBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const effIdx = resolveEffectIndex(entryPath, doc.effects.length);
        if (effIdx === undefined) return undefined;

        const owner = effectOwnerAt(doc, effIdx);
        const at = position === "before" ? effIdx : effIdx + 1;
        const effects = [...doc.effects.slice(0, at), defaultEffect(), ...doc.effects.slice(at)];
        return serializeWithValidation(applyEffectShift(doc, effects, { at, delta: 1, owner }));
    }

    /**
     * Duplicate the targeted effect, inserting a deep clone right after the source.
     * The clone inherits the source's owner: that range's count grows by 1 and later
     * ranges shift up by 1.
     */
    function buildDuplicateEffectBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const effIdx = resolveEffectIndex(entryPath, doc.effects.length);
        if (effIdx === undefined) return undefined;

        const owner = effectOwnerAt(doc, effIdx);
        // Non-null is safe: effIdx is in range per resolveEffectIndex.
        const clone = structuredClone(doc.effects[effIdx]!);
        const at = effIdx + 1;
        const effects = [...doc.effects.slice(0, at), clone, ...doc.effects.slice(at)];
        return serializeWithValidation(applyEffectShift(doc, effects, { at, delta: 1, owner }));
    }

    /**
     * Reorder the targeted effect up/down by swapping it with its neighbor, but ONLY
     * when the neighbor belongs to the SAME owner - otherwise the swap would move an
     * effect out of its owner's slice (ownership corruption), so return undefined at
     * an owner boundary. A same-owner swap changes no counts or range starts, so
     * doc.effects is swapped directly with no shiftEffectRefs.
     */
    function buildReorderEffectBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const effIdx = resolveEffectIndex(entryPath, doc.effects.length);
        if (effIdx === undefined) return undefined;

        const neighborIdx = direction === "up" ? effIdx - 1 : effIdx + 1;
        if (neighborIdx < 0 || neighborIdx >= doc.effects.length) return undefined; // edge of array

        const owners = effectOwners(doc);
        const owner = owners[effIdx];
        const neighborOwner = owners[neighborIdx];
        if (owner === undefined || neighborOwner === undefined) return undefined;
        if (!sameOwner(owner, neighborOwner)) return undefined; // cross-owner move rejected

        const effects = [...doc.effects];
        // Non-null is safe: both indices are in [0, length) per the bound checks above.
        const a = effects[effIdx]!;
        const b = effects[neighborIdx]!;
        effects[effIdx] = b;
        effects[neighborIdx] = a;
        return serializeWithValidation({ ...doc, effects });
    }

    function sameOwner(a: EffectOwner, b: EffectOwner): boolean {
        if (a.kind === "equipping" || b.kind === "equipping") return a.kind === b.kind;
        return a.index === b.index;
    }

    // -----------------------------------------------------------------------
    // Adapter predicates
    // -----------------------------------------------------------------------

    /**
     * Returns true when arrayPath identifies one of the two top-level list sections
     * (Abilities or Effects). Used by the binary editor to decide whether to render
     * the group as a list panel rather than a form.
     */
    function isListSection(arrayPath: readonly string[]): boolean {
        if (arrayPath.length !== 1) return false;
        return arrayPath[0] === ABILITIES_SECTION || arrayPath[0] === EFFECTS_SECTION;
    }

    /**
     * Returns true when the array at arrayPath supports structural mutations (add
     * or remove). Both Abilities and Effects sections are structurally mutable;
     * whether a specific op (e.g. add-effect) is available is handled per-builder.
     */
    function isModifiableArray(arrayPath: readonly string[]): boolean {
        return isListSection(arrayPath);
    }

    /**
     * Returns true only for the Abilities array. Effects have no unambiguous
     * section-level add owner (the owning ability must be known), so section-add
     * is gated off at the adapter level.
     */
    function isAddableArray(arrayPath: readonly string[]): boolean {
        return isListSection(arrayPath) && arrayPath[0] === ABILITIES_SECTION;
    }

    /**
     * Returns true when entryPath identifies a concrete ability or effect entry:
     * length 2, recognised section name, entry label matches the expected prefix.
     * Index range validation is left to the byte-builders themselves.
     */
    function isRemovableEntry(entryPath: readonly string[]): boolean {
        if (entryPath.length !== 2) return false;
        const section = entryPath[0];
        const label = entryPath[1];
        if (label === undefined) return false;
        if (section === ABILITIES_SECTION) return label.startsWith(ABILITY_LABEL_PREFIX);
        if (section === EFFECTS_SECTION) return label.startsWith(EFFECT_LABEL_PREFIX);
        return false;
    }

    return {
        abilitiesCollection,
        effectsCollection,
        relinkAbilityEffectIndices,
        buildAddAbilityBytes,
        buildInsertAbilityBytes,
        buildRemoveAbilityBytes,
        buildReorderAbilityBytes,
        buildDuplicateAbilityBytes,
        buildRemoveEffectBytes,
        buildInsertEffectBytes,
        buildDuplicateEffectBytes,
        buildReorderEffectBytes,
        isListSection,
        isModifiableArray,
        isAddableArray,
        isRemovableEntry,
    };
}
