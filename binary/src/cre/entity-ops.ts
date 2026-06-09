/**
 * CRE structure-op bindings.
 *
 * CRE has five mutable list sections with three relink models (see
 * docs cre design sub-spec / binary/INTERNALS.md):
 *
 *   - Known Spells, Effects: FLAT lists (no cross-reference). Effects is a
 *     discriminated v1/v2 union; the default element and read/write preserve
 *     the doc's current kind. Bound via createFlatListOps.
 *   - Items: a FLAT list back-referenced by the fixed itemSlots block; the
 *     flat-list relink hook remaps itemSlots (relinkItemSlots) after each op.
 *   - Spell Memorization Info (owner) + Memorized Spells (slice): an
 *     order-agnostic owner+slice partition (spellMemInfo entries own
 *     contiguous slices of memorizedSpells). Bound via createSliceStructureOps
 *     - NOT the ITM/SPL running-offset core, because 2 real fixtures lay the
 *     slices out of owner order (see slice-structure-ops.ts).
 *
 * Every default is zero-constructed from the spec shape (approach A, matching
 * itm/entity-ops.ts) so no fixture byte leaks into a "new entry" default.
 */

import { createFlatListOps, type FlatListOps } from "../ie-common/flat-list-ops";
import { createSliceStructureOps } from "../ie-common/slice-structure-ops";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "./canonical-reader";
import { serializeCreCanonicalDocument } from "./canonical-writer";
import { CRE_GROUP_LABELS, CRE_ITEM_REF_SLOT_COUNT } from "./types";
import type { IeEffectRangeFields } from "../ie-common/effect-partition";
import type { EntryMutation } from "../spec/entity-ops";
import type { CreCanonicalDocument, CreEffectsDocument } from "./canonical-schemas";
import type { ParseResult } from "../types";

type CreKnownSpell = CreCanonicalDocument["knownSpells"][number];
type CreSpellMemInfo = CreCanonicalDocument["spellMemInfo"][number];
type CreMemorizedSpell = CreCanonicalDocument["memorizedSpells"][number];
type CreItem = CreCanonicalDocument["items"][number];
type CreEffectV1 = Extract<CreEffectsDocument, { kind: "v1" }>["records"][number];
type CreEffectV2 = Extract<CreEffectsDocument, { kind: "v2" }>["records"][number];
type CreEffect = CreEffectV1 | CreEffectV2;

// Entry-label prefixes emitted by cre/index.ts.
const KNOWN_SPELL_PREFIX = "Known Spell ";
const SPELL_MEM_INFO_PREFIX = "Entry ";
const MEMORIZED_SPELL_PREFIX = "Memorized Spell ";
const EFFECT_PREFIX = "Effect ";
const ITEM_PREFIX = "Item ";

/**
 * Inventory slots [0, ITEM_TABLE_SLOTS) hold item-table indices (-1 = empty);
 * the last two slots are the selected-weapon slot index and ability index, NOT
 * item-table indices, so they are never remapped. See CRE_ITEM_SLOT_LABELS.
 * Shared with the editor's cross-record diagnostics via CRE_ITEM_REF_SLOT_COUNT.
 */
const ITEM_TABLE_SLOTS = CRE_ITEM_REF_SLOT_COUNT; // 38

/** CRE memorization-info -> memorized-spells slice range fields; shared by the relink and the descriptor. */
export const CRE_MEMINFO_FIELDS: IeEffectRangeFields = {
    abilityStart: "firstMemorizedSpellIndex",
    abilityCount: "memorizedSpellCount",
};

function readDocument(parseResult: ParseResult): CreCanonicalDocument | undefined {
    return getCreCanonicalDocument(parseResult) ?? rebuildCreCanonicalDocument(parseResult);
}

// -- defaults ---------------------------------------------------------------

export function defaultCreKnownSpell(): CreKnownSpell {
    return { spell: "", spellLevel: 0, spellType: 0 };
}

export function defaultCreSpellMemInfo(): CreSpellMemInfo {
    return {
        spellLevel: 0,
        numMemorizable: 0,
        numMemorizableEffective: 0,
        spellType: 0,
        firstMemorizedSpellIndex: 0,
        memorizedSpellCount: 0,
    };
}

export function defaultCreMemorizedSpell(): CreMemorizedSpell {
    return { spell: "", memorizedFlags: [] }; // memorizedFlags is a flags field; [] encodes to wire 0
}

export function defaultCreItem(): CreItem {
    return { item: "", expirationTime: 0, quantity1: 0, quantity2: 0, quantity3: 0, itemFlags: [] };
}

export function defaultCreEffectV1(): CreEffectV1 {
    return {
        opcode: 0,
        target: 0,
        power: 0,
        parameter1: 0,
        parameter2: 0,
        timingMode: 0,
        resistance: 0,
        duration: 0,
        probability1: 0,
        probability2: 0,
        resref: "", // chars(8)
        diceThrown: 0,
        diceSides: 0,
        savingThrowType: 0,
        savingThrowBonus: 0,
        unknown: 0,
    };
}

/**
 * EFF v2 body default. Real CRE v2 effect records carry all-zero
 * signature2/version2 (surveyed across 585 records in 140 fixtures), so the
 * empty-string chars defaults are engine-correct. resistance/saveType are
 * flags fields ([]); variableName is surfaced as chars in the annotated spec
 * (""); unused7 is a fixed 15-dword pad.
 */
export function defaultCreEffectV2(): CreEffectV2 {
    return {
        signature2: "",
        version2: "",
        opcode: 0,
        target: 0,
        power: 0,
        parameter1: 0,
        parameter2: 0,
        timing: 0,
        unused1: 0,
        duration: 0,
        probability1: 0,
        probability2: 0,
        resource: "",
        diceThrown: 0,
        diceSides: 0,
        saveType: [],
        saveBonus: 0,
        stackingIdTobex: 0,
        school: 0,
        unused2: 0,
        unused3: 0,
        unused4: 0,
        resistance: [],
        parameter3: 0,
        parameter4: 0,
        parameter5: 0,
        timeApplied: 0,
        resource2: "",
        resource3: "",
        casterXCoord: 0,
        casterYCoord: 0,
        targetXCoord: 0,
        targetYCoord: 0,
        parentResourceType: 0,
        parentResource: "",
        parentResourceFlags: 0,
        projectile: 0,
        unused5: 0,
        variableName: "",
        casterLevel: 0,
        unused6: 0,
        sectype: 0,
        unused7: Array.from({ length: 15 }, () => 0),
    };
}

function defaultCreEffect(doc: CreCanonicalDocument): CreEffect {
    return doc.effects.kind === "v1" ? defaultCreEffectV1() : defaultCreEffectV2();
}

// -- items <- itemSlots relink ----------------------------------------------

/**
 * Remap the itemSlots back-references after an items-array mutation. Slots in
 * [0, ITEM_TABLE_SLOTS) hold item-table indices (-1 = empty); the trailing
 * weapon-slot/ability slots are left untouched.
 *   - remove (delta -1 at inputIndex): slot == removed -> -1; slot > removed -> -1 shift.
 *   - add/insert/duplicate (delta +1 at insertion point): slot >= point -> +1.
 *   - reorder (swap inputIndex, mutation.index): the two referencing slots swap.
 */
export function relinkItemSlots(
    itemSlots: readonly number[],
    mutation: EntryMutation<CreItem>,
    inputIndex: number,
): number[] {
    const isTableSlot = (i: number, v: number): boolean => i < ITEM_TABLE_SLOTS && v !== -1;
    switch (mutation.op) {
        case "remove":
            return itemSlots.map((v, i) =>
                !isTableSlot(i, v) ? v : v === inputIndex ? -1 : v > inputIndex ? v - 1 : v,
            );
        case "add":
        case "insert":
        case "duplicate": {
            const at = mutation.index; // insertion point in the items array
            return itemSlots.map((v, i) => (isTableSlot(i, v) && v >= at ? v + 1 : v));
        }
        case "reorder": {
            const a = inputIndex;
            const b = mutation.index; // swap partner
            return itemSlots.map((v, i) => (!isTableSlot(i, v) ? v : v === a ? b : v === b ? a : v));
        }
    }
}

function applyItemSlotRelink(
    doc: CreCanonicalDocument,
    mutation: EntryMutation<CreItem>,
    inputIndex: number,
): CreCanonicalDocument {
    return { ...doc, itemSlots: relinkItemSlots(doc.itemSlots, mutation, inputIndex) };
}

// -- flat-list bindings -----------------------------------------------------

const knownSpellsOps: FlatListOps = createFlatListOps<CreCanonicalDocument, CreKnownSpell>({
    section: CRE_GROUP_LABELS.knownSpells,
    prefix: KNOWN_SPELL_PREFIX,
    readDocument,
    read: (doc) => doc.knownSpells,
    write: (doc, next) => ({ ...doc, knownSpells: [...next] }),
    defaultElement: defaultCreKnownSpell,
    addable: true,
    serialize: serializeCreCanonicalDocument,
});

const effectsOps: FlatListOps = createFlatListOps<CreCanonicalDocument, CreEffect>({
    section: CRE_GROUP_LABELS.effects,
    prefix: EFFECT_PREFIX,
    readDocument,
    read: (doc) => doc.effects.records,
    // Preserve the discriminated kind. The cast narrows the homogeneous (V1|V2)[]
    // to the branch's record type: read() returns one kind's records and every
    // inserted element is defaultCreEffect(doc) of the same kind, so the array is
    // kind-homogeneous; the writer's strict schema validates it on serialize.
    write: (doc, next) =>
        doc.effects.kind === "v1"
            ? { ...doc, effects: { kind: "v1", records: next as CreEffectV1[] } }
            : { ...doc, effects: { kind: "v2", records: next as CreEffectV2[] } },
    defaultElement: defaultCreEffect,
    addable: true,
    serialize: serializeCreCanonicalDocument,
});

const itemsOps: FlatListOps = createFlatListOps<CreCanonicalDocument, CreItem>({
    section: CRE_GROUP_LABELS.items,
    prefix: ITEM_PREFIX,
    readDocument,
    read: (doc) => doc.items,
    write: (doc, next) => ({ ...doc, items: [...next] }),
    defaultElement: defaultCreItem,
    addable: true,
    relink: applyItemSlotRelink,
    serialize: serializeCreCanonicalDocument,
});

// -- owner+slice binding (spellMemInfo / memorizedSpells) --------------------

const memoOps = createSliceStructureOps<CreCanonicalDocument, CreSpellMemInfo, CreMemorizedSpell>({
    fields: CRE_MEMINFO_FIELDS,
    ownerSection: CRE_GROUP_LABELS.spellMemInfo,
    ownerPrefix: SPELL_MEM_INFO_PREFIX,
    sliceSection: CRE_GROUP_LABELS.memorizedSpells,
    slicePrefix: MEMORIZED_SPELL_PREFIX,
    ownerNoun: "memorization entry",
    readDocument,
    readOwners: (doc) => doc.spellMemInfo,
    writeOwners: (doc, next) => ({ ...doc, spellMemInfo: [...next] }),
    readSlices: (doc) => doc.memorizedSpells,
    writeSlices: (doc, next) => ({ ...doc, memorizedSpells: [...next] }),
    defaultOwner: defaultCreSpellMemInfo,
    defaultSlice: defaultCreMemorizedSpell,
    serialize: serializeCreCanonicalDocument,
});

export { memoOps, knownSpellsOps, effectsOps, itemsOps };

// Exposed for the slice-element collection (effects-style: no section add).
export const creMemorizedSpellsCollection = memoOps.slicesCollection;
export const creSpellMemInfoCollection = memoOps.ownersCollection;

// -- combined adapter predicates --------------------------------------------

const FLAT_OPS: readonly FlatListOps[] = [knownSpellsOps, effectsOps, itemsOps];

export function isCreListSection(arrayPath: readonly string[]): boolean {
    return FLAT_OPS.some((o) => o.isListSection(arrayPath)) || memoOps.isListSection(arrayPath);
}

export function isCreModifiableArray(arrayPath: readonly string[]): boolean {
    return FLAT_OPS.some((o) => o.isModifiableArray(arrayPath)) || memoOps.isModifiableArray(arrayPath);
}

export function isCreAddableArray(arrayPath: readonly string[]): boolean {
    return FLAT_OPS.some((o) => o.isAddableArray(arrayPath)) || memoOps.isAddableArray(arrayPath);
}

export function isCreRemovableEntry(entryPath: readonly string[]): boolean {
    return FLAT_OPS.some((o) => o.isRemovableEntry(entryPath)) || memoOps.isRemovableEntry(entryPath);
}

// -- combined build*EntryBytes (route by section) ---------------------------

const OWNER_SECTION = CRE_GROUP_LABELS.spellMemInfo;
const SLICE_SECTION = CRE_GROUP_LABELS.memorizedSpells;

function flatOpsFor(section: string | undefined): FlatListOps | undefined {
    if (section === CRE_GROUP_LABELS.knownSpells) return knownSpellsOps;
    if (section === CRE_GROUP_LABELS.effects) return effectsOps;
    if (section === CRE_GROUP_LABELS.items) return itemsOps;
    return undefined;
}

export function buildCreAddEntryBytes(pr: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
    const section = arrayPath[0];
    if (section === OWNER_SECTION) return memoOps.buildAddOwnerBytes(pr, arrayPath);
    // Memorized spells (slice) have no section-level add (owner-ambiguous).
    return flatOpsFor(section)?.buildAddEntryBytes(pr, arrayPath);
}

export function buildCreRemoveEntryBytes(
    pr: ParseResult,
    arrayPath: readonly string[],
    index: number,
): Uint8Array | undefined {
    const section = arrayPath[0];
    if (section === OWNER_SECTION) return memoOps.buildRemoveOwnerBytes(pr, arrayPath, index);
    if (section === SLICE_SECTION) return memoOps.buildRemoveSliceBytes(pr, arrayPath, index);
    return flatOpsFor(section)?.buildRemoveEntryBytes(pr, arrayPath, index);
}

export function buildCreInsertEntryBytes(
    pr: ParseResult,
    arrayPath: readonly string[],
    index: number,
    position: "before" | "after",
): Uint8Array | undefined {
    const section = arrayPath[0];
    if (section === OWNER_SECTION) return memoOps.buildInsertOwnerBytes(pr, arrayPath, index, position);
    if (section === SLICE_SECTION) return memoOps.buildInsertSliceBytes(pr, arrayPath, index, position);
    return flatOpsFor(section)?.buildInsertEntryBytes(pr, arrayPath, index, position);
}

export function buildCreMoveEntryBytes(
    pr: ParseResult,
    arrayPath: readonly string[],
    index: number,
    direction: "up" | "down",
): Uint8Array | undefined {
    const section = arrayPath[0];
    if (section === OWNER_SECTION) return memoOps.buildReorderOwnerBytes(pr, arrayPath, index, direction);
    if (section === SLICE_SECTION) return memoOps.buildReorderSliceBytes(pr, arrayPath, index, direction);
    return flatOpsFor(section)?.buildMoveEntryBytes(pr, arrayPath, index, direction);
}

export function buildCreDuplicateEntryBytes(
    pr: ParseResult,
    arrayPath: readonly string[],
    index: number,
): Uint8Array | undefined {
    const section = arrayPath[0];
    if (section === OWNER_SECTION) return memoOps.buildDuplicateOwnerBytes(pr, arrayPath, index);
    if (section === SLICE_SECTION) return memoOps.buildDuplicateSliceBytes(pr, arrayPath, index);
    return flatOpsFor(section)?.buildDuplicateEntryBytes(pr, arrayPath, index);
}
