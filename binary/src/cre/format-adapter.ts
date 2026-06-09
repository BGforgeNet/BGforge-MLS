import type { BinaryFormatAdapter } from "../format-adapter";
import type { CrossRefRelationship } from "../cross-ref-relationship";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildCreCanonicalDocument } from "./canonical";
import { createCanonicalCreJsonSnapshot, loadCanonicalCreJsonSnapshot } from "./json-snapshot";
import { creCompiledPatternFields, creDomainRanges, crePresentationSchema } from "./presentation-schema";
import { creLayout } from "./layout-schema";
import { slugify } from "../snapshot-common";
import { CRE_GROUP_LABELS, CRE_ITEM_REF_SLOT_COUNT } from "./types";
import {
    buildCreAddEntryBytes,
    buildCreDuplicateEntryBytes,
    buildCreInsertEntryBytes,
    buildCreMoveEntryBytes,
    buildCreRemoveEntryBytes,
    CRE_MEMINFO_FIELDS,
    isCreRemovableEntry,
} from "./entity-ops";

/**
 * CRE cross-record relationships:
 *  - Item Slots [0, CRE_ITEM_REF_SLOT_COUNT) index into Items (the trailing selected-weapon slot/ability
 *    entries are not item indices and stay unchecked); orphan items are noted.
 *  - Spell Memorization Info entries slice into Memorized Spells.
 */
const creCrossRefRelationships: readonly CrossRefRelationship[] = [
    {
        kind: "index",
        refGroup: CRE_GROUP_LABELS.itemSlots,
        targetGroup: CRE_GROUP_LABELS.items,
        refNoun: "item",
        refFieldCount: CRE_ITEM_REF_SLOT_COUNT,
        orphanInfo: true,
    },
    {
        kind: "slice",
        ownerGroup: CRE_GROUP_LABELS.spellMemInfo,
        targetGroup: CRE_GROUP_LABELS.memorizedSpells,
        sliceNoun: "Memorized-spell",
        fields: CRE_MEMINFO_FIELDS,
    },
];

/**
 * Maps a top-level display-group label to the semantic-key namespace plus
 * the segment index that carries the field name. Header / Item Slots are
 * struct-shaped (field name at depth 1), the rest are array-of-records
 * (field name at depth 2 because the entry name "Item N" sits between).
 *
 * Effects: EFF v1 and v2 records share a generic per-entry group label
 * ("Effect N") with different field shapes underneath. The router projects
 * both into the v2 namespace; resolveFieldPresentation falls through to v1
 * if no v2 exact match exists for the slug.
 */
type GroupRoute = { readonly prefix: string; readonly fieldSegment: 1 | 2 };
const GROUP_ROUTES: Readonly<Record<string, GroupRoute>> = {
    [CRE_GROUP_LABELS.header]: { prefix: "cre.header", fieldSegment: 1 },
    [CRE_GROUP_LABELS.knownSpells]: { prefix: "cre.knownSpells[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.spellMemInfo]: { prefix: "cre.spellMemInfo[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.memorizedSpells]: { prefix: "cre.memorizedSpells[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.effects]: { prefix: "cre.effects[].v2", fieldSegment: 2 },
    [CRE_GROUP_LABELS.items]: { prefix: "cre.items[]", fieldSegment: 2 },
    [CRE_GROUP_LABELS.itemSlots]: { prefix: "cre.itemSlots", fieldSegment: 1 },
};

function creSemanticFieldKey(segments: readonly string[]): string | undefined {
    if (segments.length === 0) return undefined;
    const route = GROUP_ROUTES[segments[0]!];
    if (route) {
        const fieldName = segments[route.fieldSegment];
        if (!fieldName) return route.prefix;
        // A header sub-group leaf (a Sound Slots / Object Refs slot) keeps its slot in the key so each slot
        // gets a distinct key instead of all of them collapsing to the sub-group's key. (Proficiencies are now
        // flat packed header fields - no slot leaf - so they take the plain `cre.header.<field>` branch below.)
        const leaf = segments[route.fieldSegment + 1];
        return leaf
            ? `${route.prefix}.${slugify(fieldName)}.${slugify(leaf)}`
            : `${route.prefix}.${slugify(fieldName)}`;
    }
    // Fall-through for nested walkStruct sub-groups (e.g. future packed-field
    // sub-groups). Slugified path keeps presentation lookup routable.
    if (segments.length > 1) return `cre.${segments.map((s) => slugify(s)).join(".")}`;
    return undefined;
}

export const creFormatAdapter: BinaryFormatAdapter = {
    formatId: "cre",
    presentationSchema: crePresentationSchema,
    compiledPatternFields: creCompiledPatternFields,
    domainRanges: creDomainRanges,
    // IE formats cache a rebuildable canonical document (own writable property); clear it on edit.
    documentCacheStrategy: "clear",
    layout: creLayout,
    crossRefRelationships: creCrossRefRelationships,

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalCreJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalCreJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildCreCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return creSemanticFieldKey(segments);
    },

    isRemovableEntry(entryPath: readonly string[]): boolean {
        return isCreRemovableEntry(entryPath);
    },

    buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        return buildCreAddEntryBytes(parseResult, arrayPath);
    },

    buildRemoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        return buildCreRemoveEntryBytes(parseResult, arrayPath, index);
    },

    buildInsertEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ): Uint8Array | undefined {
        return buildCreInsertEntryBytes(parseResult, arrayPath, index, position);
    },

    buildMoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ): Uint8Array | undefined {
        return buildCreMoveEntryBytes(parseResult, arrayPath, index, direction);
    },

    buildDuplicateEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        return buildCreDuplicateEntryBytes(parseResult, arrayPath, index);
    },
};
