/**
 * Structure-op byte-builders for a single FLAT array section - one ordered
 * list with no per-entry cross-reference ranges (the simplest model).
 *
 * Used by CRE's standalone lists: knownSpells (no relink), effects (the
 * default element is chosen per the doc's discriminated v1/v2 kind, and
 * read/write preserve that kind), and items (an optional relink hook remaps
 * the itemSlots back-references after the mutation). The canonical writer
 * recomputes the header's derived count/offset for each section, so a flat op
 * is just: mutate the array, run the relink hook, serialize.
 *
 * MAP's var-section ops are intentionally NOT refactored onto this factory:
 * they carry opaque-range shifting (MAP files keep an undecoded tile/object
 * tail), whereas CRE is fully canonical with no opaque ranges. Forcing both
 * through one factory would leak MAP's opaque-range concern into CRE.
 */

import { applyEntryMutation, type EntryMutation, type EntryOpKind } from "../spec/entity-ops";
import type { ParseResult } from "../types";

export interface FlatListOpsConfig<Doc, Entry> {
    /** Display-tree section name (e.g. "Known Spells") and entry-label prefix (e.g. "Known Spell "). */
    readonly section: string;
    readonly prefix: string;
    readonly readDocument: (parseResult: ParseResult) => Doc | undefined;
    readonly read: (doc: Doc) => readonly Entry[];
    readonly write: (doc: Doc, next: readonly Entry[]) => Doc;
    /** Doc-aware so a discriminated section (CRE effects v1/v2) can pick the matching default. */
    readonly defaultElement: (doc: Doc) => Entry;
    /** Whether the section supports a bare section-level add (true for all CRE flat lists). */
    readonly addable: boolean;
    /**
     * Maintain back-references the canonical writer does not derive (CRE items ->
     * itemSlots). Runs after the array mutation, before serialize. Receives the
     * array-updated doc, the mutation descriptor, and the original target index
     * (for reorder, the source whose swap partner is mutation.index).
     */
    readonly relink?: (doc: Doc, mutation: EntryMutation<Entry>, inputIndex: number) => Doc;
    readonly serialize: (doc: Doc) => Uint8Array;
}

export interface FlatListOps {
    readonly buildAddEntryBytes: (pr: ParseResult, arrayPath: readonly string[]) => Uint8Array | undefined;
    readonly buildRemoveEntryBytes: (pr: ParseResult, entryPath: readonly string[]) => Uint8Array | undefined;
    readonly buildInsertEntryBytes: (
        pr: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ) => Uint8Array | undefined;
    readonly buildMoveEntryBytes: (
        pr: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ) => Uint8Array | undefined;
    readonly buildDuplicateEntryBytes: (pr: ParseResult, entryPath: readonly string[]) => Uint8Array | undefined;
    readonly isListSection: (arrayPath: readonly string[]) => boolean;
    readonly isModifiableArray: (arrayPath: readonly string[]) => boolean;
    readonly isAddableArray: (arrayPath: readonly string[]) => boolean;
    readonly isRemovableEntry: (entryPath: readonly string[]) => boolean;
}

export function createFlatListOps<Doc, Entry>(config: FlatListOpsConfig<Doc, Entry>): FlatListOps {
    const { section, prefix, readDocument, read, write, defaultElement, addable, relink, serialize } = config;

    function resolveIndex(entryPath: readonly string[], count: number): number | undefined {
        if (entryPath.length !== 2 || entryPath[0] !== section) return undefined;
        const label = entryPath[1];
        if (label === undefined || !label.startsWith(prefix)) return undefined;
        const oneBased = Number.parseInt(label.slice(prefix.length), 10);
        if (!Number.isInteger(oneBased)) return undefined;
        const index = oneBased - 1;
        if (index < 0 || index >= count) return undefined;
        return index;
    }

    /** Apply a resolved mutation: relink (if configured) then serialize. */
    function finalize(doc: Doc, mutation: EntryMutation<Entry>, inputIndex: number): Uint8Array {
        const arrayUpdated = write(doc, mutation.next);
        const relinked = relink ? relink(arrayUpdated, mutation, inputIndex) : arrayUpdated;
        return serialize(relinked);
    }

    function mutateAt(
        parseResult: ParseResult,
        index: number,
        op: EntryOpKind,
        position?: "before" | "after",
        direction?: "up" | "down",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const current = read(doc);
        const mutation = applyEntryMutation(current, op, index, () => defaultElement(doc), position, direction);
        if (!mutation) return undefined;
        return finalize(doc, mutation, index);
    }

    function buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        if (!addable || arrayPath.length !== 1 || arrayPath[0] !== section) return undefined;
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const current = read(doc);
        const mutation = applyEntryMutation(current, "add", current.length, () => defaultElement(doc));
        if (!mutation) return undefined;
        return finalize(doc, mutation, current.length);
    }

    function buildRemoveEntryBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveIndex(entryPath, read(doc).length);
        if (index === undefined) return undefined;
        return mutateAt(parseResult, index, "remove");
    }

    function buildInsertEntryBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveIndex(entryPath, read(doc).length);
        if (index === undefined) return undefined;
        return mutateAt(parseResult, index, "insert", position);
    }

    function buildMoveEntryBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveIndex(entryPath, read(doc).length);
        if (index === undefined) return undefined;
        return mutateAt(parseResult, index, "reorder", undefined, direction);
    }

    function buildDuplicateEntryBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const doc = readDocument(parseResult);
        if (!doc) return undefined;
        const index = resolveIndex(entryPath, read(doc).length);
        if (index === undefined) return undefined;
        return mutateAt(parseResult, index, "duplicate");
    }

    function isListSection(arrayPath: readonly string[]): boolean {
        return arrayPath.length === 1 && arrayPath[0] === section;
    }

    function isAddableArray(arrayPath: readonly string[]): boolean {
        return addable && isListSection(arrayPath);
    }

    function isRemovableEntry(entryPath: readonly string[]): boolean {
        if (entryPath.length !== 2 || entryPath[0] !== section) return false;
        const label = entryPath[1];
        return label !== undefined && label.startsWith(prefix);
    }

    return {
        buildAddEntryBytes,
        buildRemoveEntryBytes,
        buildInsertEntryBytes,
        buildMoveEntryBytes,
        buildDuplicateEntryBytes,
        isListSection,
        isModifiableArray: isListSection,
        isAddableArray,
        isRemovableEntry,
    };
}
