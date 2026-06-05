/**
 * ITM EntryCollection descriptors and default-element factories for abilities
 * and effects.
 *
 * Approach: zero-construct from the spec shape (approach A). Every field is
 * assigned its natural zero/empty value based on its SpecData projection:
 * - scalar without flags -> 0
 * - scalar with flags -> [] (empty flag array; encodes to wire value 0)
 * - chars field -> "" (NUL-padded to the byte budget on write)
 * - fixed-count array -> number[] of the declared length, all zeros
 *
 * This keeps defaults independent of any fixture - no fixture byte leaks into
 * the default. The alternative (clone-from-parsed) would tie the default to
 * whichever fixture happened to be used, which is a poor user-facing default
 * for a "new ability" workflow.
 *
 * Acceptance gate: a doc with the default ability/effect must serialize via
 * serializeItmCanonicalDocument and reparse without errors, and the default
 * ability must have featureBlockCount === 0. The relink hooks (Tasks 5/6) are
 * left undefined here; the byte-builder callers that need relink come next.
 */

import { applyEntryMutation, type EntryCollection } from "../spec/entity-ops";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "./canonical-reader";
import { serializeItmCanonicalDocument } from "./canonical-writer";
import { validateEffectPartition } from "./effect-partition";
import type { ItmCanonicalDocument } from "./canonical-schemas";
import type { ParseResult } from "../types";

// ItmCanonicalDocument["abilities"][number] is SpecData<typeof itmAbilitySpecAnnotated>.
// ItmCanonicalDocument["effects"][number] is SpecData<typeof effectSpecAnnotated>.
// Using the structural array element type directly avoids importing the spec
// annotations just to re-derive what the type already expresses.
type ItmAbility = ItmCanonicalDocument["abilities"][number];
type ItmEffect = ItmCanonicalDocument["effects"][number];

/**
 * Returns a valid default ITM ability with no owned effects.
 *
 * featureBlockCount is 0 and featureBlockIndex is 0; the relink hook in Task 5
 * fixes the index on insert. Every other field is the zero value for its type.
 * attackType 0 = "None", location 0 = "None", target 0 = "Invalid",
 * depletion 0 = "Item remains" - all valid closed-enum members.
 */
export function defaultItmAbility(): ItmAbility {
    return {
        attackType: 0,
        idRequired: [], // flags field; [] encodes to wire 0
        location: 0,
        alternativeDiceSides: 0,
        useIcon: "", // chars(8); NUL-padded to 8 bytes on write
        target: 0,
        targetCount: 0,
        range: 0,
        projectileType: 0,
        alternativeDiceThrown: 0,
        speed: 0,
        alternativeDamageBonus: 0,
        thac0Bonus: 0,
        diceSides: 0,
        primaryType: 0,
        diceThrown: 0,
        secondaryType: 0,
        damageBonus: 0,
        damageType: 0,
        featureBlockCount: 0,
        featureBlockIndex: 0,
        maxCharges: 0,
        depletion: 0,
        flags: [], // flags field; [] encodes to wire 0
        projectileAnimation: 0,
        meleeAnimation: [0, 0, 0], // fixed-count array, count 3
        isArrow: 0,
        isBolt: 0,
        isBullet: 0,
    };
}

/**
 * Returns a valid default effect (opcode 0 = "None"), all fields zero/empty.
 */
export function defaultItmEffect(): ItmEffect {
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

/**
 * EntryCollection descriptor for ITM abilities.
 *
 * read/write operate on the document-level abilities array. addable and
 * removable are both true because abilities are a standalone ordered list -
 * the relink hook (Task 5) maintains featureBlockIndex/Count on mutations.
 * relink is left undefined here and added in Task 5.
 */
export const itmAbilitiesCollection: EntryCollection<ItmCanonicalDocument, ItmAbility> = {
    read: (doc) => doc.abilities,
    write: (doc, next) => ({ ...doc, abilities: [...next] }),
    defaultElement: defaultItmAbility,
    addable: true,
    removable: true,
    // relink added in Task 5: maintains featureBlockIndex/Count after mutations
};

/**
 * EntryCollection descriptor for ITM effects.
 *
 * addable is false because a new effect has no unambiguous owner: callers
 * would not know which ability's featureBlockIndex/Count to update without
 * additional context. The UI gates "add effect" at the ability level (Task 5/6).
 * removable is true; the relink hook is added in Task 6.
 */
export const itmEffectsCollection: EntryCollection<ItmCanonicalDocument, ItmEffect> = {
    read: (doc) => doc.effects,
    write: (doc, next) => ({ ...doc, effects: [...next] }),
    defaultElement: defaultItmEffect,
    addable: false, // owner-ambiguous: callers must specify the owning ability to add
    removable: true,
    // relink added in Task 6: shifts per-ability featureBlockIndex/Count after removals
};

/**
 * Re-derive every ability's featureBlockIndex as a running offset over the flat
 * effects array, returning a NEW doc (no mutation of the input).
 *
 * The equipping range always sits first (index 0); abilities own contiguous
 * slices in order after it. So the authoritative layout is fully determined by
 * the per-owner COUNTS: walk equipping, then each ability in order, advancing a
 * running cursor by each owner's count and stamping the cursor as that owner's
 * start.
 *
 * Why re-derive instead of shiftEffectRefs: an ability op moves a whole effect
 * SLICE (reorder swaps two adjacent slices, duplicate clones one, remove deletes
 * an owner entirely). shiftEffectRefs is a per-position count adjust around a
 * single edit point; it cannot express a slice move or an owner vanishing.
 * Running-offset re-derivation from the counts is the slice-correct relink and
 * is safe because the contiguous-in-order, equipping-first invariant is proven
 * to hold for all real ITM data (see effect-partition.ts). It is idempotent: on
 * an unedited doc it reproduces the identical indices, so a no-op round-trips
 * byte-identically.
 *
 * The caller is responsible for keeping each ability's featureBlockCount in sync
 * with the actual effects slice it splices; this helper trusts those counts.
 */
export function relinkAbilityEffectIndices(doc: ItmCanonicalDocument): ItmCanonicalDocument {
    const equippingStart = 0;
    let running = equippingStart + doc.header.featureBlocksCount;
    const abilities = doc.abilities.map((ability) => {
        const next = { ...ability, featureBlockIndex: running };
        running += ability.featureBlockCount;
        return next;
    });
    return {
        ...doc,
        header: { ...doc.header, featureBlocksIndex: equippingStart },
        abilities,
    };
}

function readDocument(parseResult: ParseResult): ItmCanonicalDocument | undefined {
    return getItmCanonicalDocument(parseResult) ?? rebuildItmCanonicalDocument(parseResult);
}

/**
 * Resolve a 0-based ability index from an entry path like ["Abilities", "Ability N"].
 * The display tree labels abilities 1-based ("Ability 1" is abilities[0]), per
 * ie-common/ability-effects-parser.ts. Returns undefined for any path that is
 * not an in-range ability address.
 */
function resolveAbilityIndex(entryPath: readonly string[], abilityCount: number): number | undefined {
    if (entryPath.length !== 2 || entryPath[0] !== "Abilities") return undefined;
    const label = entryPath[1];
    if (label === undefined || !label.startsWith("Ability ")) return undefined;
    const oneBased = Number.parseInt(label.slice("Ability ".length), 10);
    if (!Number.isInteger(oneBased)) return undefined;
    const index = oneBased - 1;
    if (index < 0 || index >= abilityCount) return undefined;
    return index;
}

/** The pre-edit effect slice an ability owns, read from the ORIGINAL doc. */
function abilitySlice(doc: ItmCanonicalDocument, index: number): { start: number; count: number } {
    // Non-null is safe: every caller resolves `index` through resolveAbilityIndex, which returns
    // undefined for any out-of-range slot; reorder's lo/hi both derive from that resolved index.
    const ability = doc.abilities[index]!;
    return { start: ability.featureBlockIndex, count: ability.featureBlockCount };
}

function cloneEffects(effects: readonly ItmEffect[]): ItmEffect[] {
    // structuredClone gives an independent deep copy so a duplicated slice does
    // not alias the source (flags arrays / nested fields stay distinct).
    return effects.map((effect) => structuredClone(effect));
}

/**
 * Finalize a structural ability edit: re-derive the running-offset indices, then
 * validate the partition. A non-empty issue list means the slice op and the
 * counts disagree (a relink bug) - throw rather than emit a corrupt file, since
 * this module is the sole guard for per-ability effect ranges.
 */
function finalizeAndSerialize(doc: ItmCanonicalDocument): Uint8Array {
    const relinked = relinkAbilityEffectIndices(doc);
    const issues = validateEffectPartition(relinked);
    if (issues.length > 0) {
        throw new Error(`ITM ability relink produced an inconsistent effect partition: ${issues.join("; ")}`);
    }
    return serializeItmCanonicalDocument(relinked);
}

/** Append a new empty-slice ability. effects[] is unchanged. */
export function buildItmAddAbilityBytes(
    parseResult: ParseResult,
    arrayPath: readonly string[],
): Uint8Array | undefined {
    if (arrayPath.length !== 1 || arrayPath[0] !== "Abilities") return undefined;
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const mutation = applyEntryMutation(doc.abilities, "add", doc.abilities.length, defaultItmAbility);
    if (!mutation) return undefined;
    return finalizeAndSerialize({ ...doc, abilities: [...mutation.next] });
}

/** Insert a new empty-slice ability before/after the targeted slot. effects[] is unchanged. */
export function buildItmInsertAbilityBytes(
    parseResult: ParseResult,
    entryPath: readonly string[],
    position: "before" | "after",
): Uint8Array | undefined {
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const index = resolveAbilityIndex(entryPath, doc.abilities.length);
    if (index === undefined) return undefined;
    const mutation = applyEntryMutation(doc.abilities, "insert", index, defaultItmAbility, position);
    if (!mutation) return undefined;
    return finalizeAndSerialize({ ...doc, abilities: [...mutation.next] });
}

/** Remove the targeted ability AND its owned effect slice. */
export function buildItmRemoveAbilityBytes(
    parseResult: ParseResult,
    entryPath: readonly string[],
): Uint8Array | undefined {
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const index = resolveAbilityIndex(entryPath, doc.abilities.length);
    if (index === undefined) return undefined;
    const mutation = applyEntryMutation(doc.abilities, "remove", index, defaultItmAbility);
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
export function buildItmReorderAbilityBytes(
    parseResult: ParseResult,
    entryPath: readonly string[],
    direction: "up" | "down",
): Uint8Array | undefined {
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const index = resolveAbilityIndex(entryPath, doc.abilities.length);
    if (index === undefined) return undefined;
    const mutation = applyEntryMutation(doc.abilities, "reorder", index, defaultItmAbility, undefined, direction);
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
export function buildItmDuplicateAbilityBytes(
    parseResult: ParseResult,
    entryPath: readonly string[],
): Uint8Array | undefined {
    const doc = readDocument(parseResult);
    if (!doc) return undefined;
    const index = resolveAbilityIndex(entryPath, doc.abilities.length);
    if (index === undefined) return undefined;
    const mutation = applyEntryMutation(doc.abilities, "duplicate", index, defaultItmAbility);
    if (!mutation) return undefined;

    const { start, count } = abilitySlice(doc, index);
    const clonedSlice = cloneEffects(doc.effects.slice(start, start + count));
    const effects = [...doc.effects.slice(0, start + count), ...clonedSlice, ...doc.effects.slice(start + count)];
    return finalizeAndSerialize({ ...doc, abilities: [...mutation.next], effects });
}
