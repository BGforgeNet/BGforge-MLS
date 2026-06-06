/**
 * Order-agnostic owner+slice structure-op core.
 *
 * The sibling `structure-ops.ts` serves ITM/SPL, whose effect partition is
 * proven (over every real fixture) to be equipping-first and contiguous IN
 * OWNER ORDER - so its ability ops relink via running-offset re-derivation.
 *
 * CRE's spell-memorization partition (spellMemInfo entries owning contiguous
 * slices of memorizedSpells) is also complete and non-overlapping, but it is
 * NOT guaranteed to be in owner order: 2 of 165 real `.cre` fixtures
 * (quayle4, quayle6) lay a later owner's slice physically before an earlier
 * owner's. Running-offset re-derivation would silently reorder those
 * unrelated slices on an unrelated edit. This core therefore relinks
 * SURGICALLY and never assumes owner-order == physical-order:
 *
 *   - owner add/insert: append/splice an EMPTY owner (count 0); slices unchanged.
 *   - owner remove: drop the owner AND splice out its physical slice; every other
 *     owner whose start sits after the removed block shifts down by the block size.
 *   - owner reorder: swap two owner RECORDS (each carries its own start/count);
 *     the slice array is untouched - a pure owner-order change, no relink.
 *   - owner duplicate: clone the owner, splice a cloned slice in right after the
 *     source slice, shift owners starting at/after that point up, point the clone
 *     at the inserted block.
 *   - slice-element ops (insert/remove/duplicate/reorder one memorized spell):
 *     reuse the extended partition's surgical shiftEffectRefs / effectOwners
 *     (owner-identity based, already order-agnostic).
 *
 * The save path validates with the RELAXED partition (coverage + overlap +
 * bounds, no ordering) before serializing, so a hand-edited orphan/overlap
 * still fails loud rather than emitting a corrupt file.
 */

import { applyEntryMutation, type EntryCollection } from "../spec/entity-ops";
import {
    createEffectPartition,
    type EffectOwner,
    type EffectPartitionDoc,
    type IeEffectRangeFields,
    readNum,
} from "./effect-partition";
import type { ParseResult } from "../types";

export interface SliceStructureOpsConfig<Doc, Owner, Slice> {
    /**
     * Owner range field names (abilityStart/abilityCount); the header range is
     * omitted (CRE memorization has none). Passed straight to createEffectPartition.
     */
    readonly fields: IeEffectRangeFields;
    /** Display-tree section name + entry-label prefix for the owner list (e.g. "Spell Memorization Info" / "Entry "). */
    readonly ownerSection: string;
    readonly ownerPrefix: string;
    /** Display-tree section name + entry-label prefix for the slice list (e.g. "Memorized Spells" / "Memorized Spell "). */
    readonly sliceSection: string;
    readonly slicePrefix: string;
    /** Diagnostic noun for an owner range (e.g. "memorization entry"). */
    readonly ownerNoun: string;
    readonly readDocument: (parseResult: ParseResult) => Doc | undefined;
    readonly readOwners: (doc: Doc) => readonly Owner[];
    readonly writeOwners: (doc: Doc, next: readonly Owner[]) => Doc;
    readonly readSlices: (doc: Doc) => readonly Slice[];
    readonly writeSlices: (doc: Doc, next: readonly Slice[]) => Doc;
    readonly defaultOwner: () => Owner;
    readonly defaultSlice: () => Slice;
    readonly serialize: (doc: Doc) => Uint8Array;
}

export interface SliceStructureOps<Doc, Owner, Slice> {
    readonly ownersCollection: EntryCollection<Doc, Owner>;
    readonly slicesCollection: EntryCollection<Doc, Slice>;
    readonly buildAddOwnerBytes: (pr: ParseResult, arrayPath: readonly string[]) => Uint8Array | undefined;
    readonly buildInsertOwnerBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ) => Uint8Array | undefined;
    readonly buildRemoveOwnerBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ) => Uint8Array | undefined;
    readonly buildReorderOwnerBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ) => Uint8Array | undefined;
    readonly buildDuplicateOwnerBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ) => Uint8Array | undefined;
    readonly buildRemoveSliceBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ) => Uint8Array | undefined;
    readonly buildInsertSliceBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ) => Uint8Array | undefined;
    readonly buildDuplicateSliceBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ) => Uint8Array | undefined;
    readonly buildReorderSliceBytes: (
        pr: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ) => Uint8Array | undefined;
    readonly isListSection: (arrayPath: readonly string[]) => boolean;
    readonly isModifiableArray: (arrayPath: readonly string[]) => boolean;
    readonly isAddableArray: (arrayPath: readonly string[]) => boolean;
    readonly isRemovableEntry: (entryPath: readonly string[]) => boolean;
}

export function createSliceStructureOps<Doc, Owner extends Record<string, unknown>, Slice>(
    config: SliceStructureOpsConfig<Doc, Owner, Slice>,
): SliceStructureOps<Doc, Owner, Slice> {
    const {
        fields,
        ownerSection,
        ownerPrefix,
        sliceSection,
        slicePrefix,
        ownerNoun,
        readDocument,
        readOwners,
        writeOwners,
        readSlices,
        writeSlices,
        defaultOwner,
        defaultSlice,
        serialize,
    } = config;

    const partition = createEffectPartition<Record<string, unknown>, Owner>(fields, {
        requireContiguousOrder: false,
        ownerNoun,
    });

    // -- generic index/label resolution --------------------------------------

    function resolveIndex(
        arrayPath: readonly string[],
        index: number,
        section: string,
        count: number,
    ): number | undefined {
        if (arrayPath.length !== 1 || arrayPath[0] !== section) return undefined;
        if (!Number.isInteger(index) || index < 0 || index >= count) return undefined;
        return index;
    }

    /** A partition view of the doc: owners as "abilities", slices as "effects", empty header. */
    function partitionView(
        owners: readonly Owner[],
        slices: readonly Slice[],
    ): EffectPartitionDoc<Record<string, unknown>, Owner> {
        return { header: {}, abilities: [...owners], effects: [...slices] };
    }

    function ownerRange(owner: Owner): { start: number; count: number } {
        return { start: readNum(owner, fields.abilityStart), count: readNum(owner, fields.abilityCount) };
    }

    function setOwnerStart(owner: Owner, start: number): Owner {
        // Computed-key spread widens the type; the runtime shape is unchanged (abilityStart
        // is one of the owner's own numeric range fields), so the cast is isolated here.
        return { ...owner, [fields.abilityStart]: start } as Owner;
    }

    /**
     * Remap owner slice-starts after inserting/removing a contiguous block of
     * `blockSize` slices at `at`. Populated owners keep the raw shift (a negative
     * or past-end result is a genuine bug the validator must trip on); empty
     * owners (count 0) carry an inert start and are clamped into [0, newTotal]
     * so they stay valid wire indices (mirrors effect-partition.shiftStart).
     */
    function remapStarts(owners: readonly Owner[], at: number, delta: number, newTotal: number): Owner[] {
        return owners.map((owner) => {
            const { start, count } = ownerRange(owner);
            if (start < at) return owner;
            const shifted = start + delta;
            const next = count > 0 ? shifted : Math.max(0, Math.min(shifted, newTotal));
            return setOwnerStart(owner, next);
        });
    }

    function serializeWithValidation(owners: readonly Owner[], slices: readonly Slice[], doc: Doc): Uint8Array {
        const issues = partition.validateEffectPartition(partitionView(owners, slices));
        if (issues.length > 0) {
            throw new Error(`CRE slice structure-op produced an inconsistent partition: ${issues.join("; ")}`);
        }
        return serialize(writeSlices(writeOwners(doc, owners), slices));
    }

    // -- owner ops (surgical, order-agnostic) --------------------------------

    function buildAddOwnerBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        if (arrayPath.length !== 1 || arrayPath[0] !== ownerSection) return undefined;
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        // New owner owns no slices (count 0). Its start is inert; defaultOwner sets it to 0.
        const next = [...owners, defaultOwner()];
        return serializeWithValidation(next, readSlices(doc), doc);
    }

    function buildInsertOwnerBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        if (resolveIndex(arrayPath, index, ownerSection, owners.length) === undefined) return undefined;
        const mutation = applyEntryMutation(owners, "insert", index, defaultOwner, position);
        if (!mutation) return undefined;
        // The inserted owner has count 0, so slices are unchanged.
        return serializeWithValidation([...mutation.next], readSlices(doc), doc);
    }

    function buildRemoveOwnerBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        if (resolveIndex(arrayPath, index, ownerSection, owners.length) === undefined) return undefined;
        // Non-null safe: index is in range per resolveIndex.
        const { start, count } = ownerRange(owners[index]!);

        const slices = readSlices(doc);
        const nextSlices = [...slices.slice(0, start), ...slices.slice(start + count)];
        // Drop the owner, then shift every remaining owner whose slice began after the
        // removed block down by the block size. Owners strictly before `start` are
        // untouched; the removed owner's own start is gone.
        const remaining = [...owners.slice(0, index), ...owners.slice(index + 1)];
        const nextOwners = remapStarts(remaining, start + count, -count, nextSlices.length);
        return serializeWithValidation(nextOwners, nextSlices, doc);
    }

    function buildReorderOwnerBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        if (resolveIndex(arrayPath, index, ownerSection, owners.length) === undefined) return undefined;
        const mutation = applyEntryMutation(owners, "reorder", index, defaultOwner, undefined, direction);
        if (!mutation) return undefined; // boundary no-op
        // Each owner carries its own start/count, so swapping records keeps every
        // owner pointing at its (unchanged) physical slice. No slice change, no relink.
        return serializeWithValidation([...mutation.next], readSlices(doc), doc);
    }

    function buildDuplicateOwnerBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        if (resolveIndex(arrayPath, index, ownerSection, owners.length) === undefined) return undefined;
        // Non-null safe: index is in range per resolveIndex.
        const source = owners[index]!;
        const { start, count } = ownerRange(source);

        const slices = readSlices(doc);
        const at = start + count; // insert the cloned block right after the source slice
        const clonedSlice = slices.slice(start, start + count).map((s) => structuredClone(s));
        const nextSlices = [...slices.slice(0, at), ...clonedSlice, ...slices.slice(at)];

        // Shift owners whose slice starts at/after the insertion point up by the block size,
        // THEN build the clone (its start is the insertion point, count matches the source).
        const shifted = remapStarts(owners, at, count, nextSlices.length);
        const clone = setOwnerStart(structuredClone(source), at);
        const nextOwners = [...shifted.slice(0, index + 1), clone, ...shifted.slice(index + 1)];
        return serializeWithValidation(nextOwners, nextSlices, doc);
    }

    // -- slice-element ops (reuse the surgical partition shifter) -------------

    function sliceOwnerAt(view: EffectPartitionDoc<Record<string, unknown>, Owner>, sliceIdx: number): EffectOwner {
        const owner = partition.effectOwners(view)[sliceIdx];
        if (owner === undefined) {
            throw new Error(
                `CRE slice index ${sliceIdx} has no owning ${ownerNoun} (orphan); cannot apply structure-op`,
            );
        }
        return owner;
    }

    /** Apply a +/-1 slice splice at `at` attributed to `owner`, returning the relinked owners. */
    function applySliceShift(
        owners: readonly Owner[],
        slices: readonly Slice[],
        at: number,
        delta: number,
        owner: EffectOwner,
    ): Owner[] {
        const shifted = partition.shiftEffectRefs(partitionView(owners, slices), { at, delta, owner });
        return shifted.abilities;
    }

    function buildRemoveSliceBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        const slices = readSlices(doc);
        const sliceIdx = resolveIndex(arrayPath, index, sliceSection, slices.length);
        if (sliceIdx === undefined) return undefined;

        const view = partitionView(owners, slices);
        const owner = sliceOwnerAt(view, sliceIdx);
        const nextSlices = [...slices.slice(0, sliceIdx), ...slices.slice(sliceIdx + 1)];
        const nextOwners = applySliceShift(owners, slices, sliceIdx, -1, owner);
        return serializeWithValidation(nextOwners, nextSlices, doc);
    }

    function buildInsertSliceBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        const slices = readSlices(doc);
        const sliceIdx = resolveIndex(arrayPath, index, sliceSection, slices.length);
        if (sliceIdx === undefined) return undefined;

        const view = partitionView(owners, slices);
        const owner = sliceOwnerAt(view, sliceIdx);
        const at = position === "before" ? sliceIdx : sliceIdx + 1;
        const nextSlices = [...slices.slice(0, at), defaultSlice(), ...slices.slice(at)];
        const nextOwners = applySliceShift(owners, slices, at, 1, owner);
        return serializeWithValidation(nextOwners, nextSlices, doc);
    }

    function buildDuplicateSliceBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        const slices = readSlices(doc);
        const sliceIdx = resolveIndex(arrayPath, index, sliceSection, slices.length);
        if (sliceIdx === undefined) return undefined;

        const view = partitionView(owners, slices);
        const owner = sliceOwnerAt(view, sliceIdx);
        // Non-null safe: sliceIdx in range per resolveIndex.
        const clone = structuredClone(slices[sliceIdx]!);
        const at = sliceIdx + 1;
        const nextSlices = [...slices.slice(0, at), clone, ...slices.slice(at)];
        const nextOwners = applySliceShift(owners, slices, at, 1, owner);
        return serializeWithValidation(nextOwners, nextSlices, doc);
    }

    function buildReorderSliceBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const owners = readOwners(doc);
        const slices = readSlices(doc);
        const sliceIdx = resolveIndex(arrayPath, index, sliceSection, slices.length);
        if (sliceIdx === undefined) return undefined;

        const neighborIdx = direction === "up" ? sliceIdx - 1 : sliceIdx + 1;
        if (neighborIdx < 0 || neighborIdx >= slices.length) return undefined; // edge of array

        // Only swap within one owner: a cross-owner swap would move a slice out of its
        // owner's range (ownership corruption). A same-owner swap changes no starts/counts.
        const owners2 = partition.effectOwners(partitionView(owners, slices));
        const a = owners2[sliceIdx];
        const b = owners2[neighborIdx];
        if (a === undefined || b === undefined || !sameOwner(a, b)) return undefined;

        const nextSlices = [...slices];
        // Non-null safe: both indices in [0, length).
        const tmp = nextSlices[sliceIdx]!;
        nextSlices[sliceIdx] = nextSlices[neighborIdx]!;
        nextSlices[neighborIdx] = tmp;
        return serializeWithValidation(owners, nextSlices, doc);
    }

    function sameOwner(a: EffectOwner, b: EffectOwner): boolean {
        if (a.kind === "equipping" || b.kind === "equipping") return a.kind === b.kind;
        return a.index === b.index;
    }

    // -- collections (capability descriptors for the adapter) ----------------

    const ownersCollection: EntryCollection<Doc, Owner> = {
        read: (doc) => readOwners(doc),
        write: (doc, next) => writeOwners(doc, [...next]),
        defaultElement: defaultOwner,
        addable: true,
        removable: true,
    };

    const slicesCollection: EntryCollection<Doc, Slice> = {
        read: (doc) => readSlices(doc),
        write: (doc, next) => writeSlices(doc, [...next]),
        defaultElement: defaultSlice,
        addable: false, // owner-ambiguous: a bare add has no owning range
        removable: true,
    };

    // -- adapter predicates --------------------------------------------------

    function isListSection(arrayPath: readonly string[]): boolean {
        return arrayPath.length === 1 && (arrayPath[0] === ownerSection || arrayPath[0] === sliceSection);
    }

    function isModifiableArray(arrayPath: readonly string[]): boolean {
        return isListSection(arrayPath);
    }

    function isAddableArray(arrayPath: readonly string[]): boolean {
        // Owners are section-addable; slices are owner-ambiguous (insert-relative only).
        return arrayPath.length === 1 && arrayPath[0] === ownerSection;
    }

    function isRemovableEntry(entryPath: readonly string[]): boolean {
        if (entryPath.length !== 2) return false;
        const section = entryPath[0];
        const label = entryPath[1];
        if (label === undefined) return false;
        if (section === ownerSection) return label.startsWith(ownerPrefix);
        if (section === sliceSection) return label.startsWith(slicePrefix);
        return false;
    }

    return {
        ownersCollection,
        slicesCollection,
        buildAddOwnerBytes,
        buildInsertOwnerBytes,
        buildRemoveOwnerBytes,
        buildReorderOwnerBytes,
        buildDuplicateOwnerBytes,
        buildRemoveSliceBytes,
        buildInsertSliceBytes,
        buildDuplicateSliceBytes,
        buildReorderSliceBytes,
        isListSection,
        isModifiableArray,
        isAddableArray,
        isRemovableEntry,
    };
}
