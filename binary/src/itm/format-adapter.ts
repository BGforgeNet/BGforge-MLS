import type { BinaryFormatAdapter } from "../format-adapter";
import type { CrossRefRelationship } from "../cross-ref-relationship";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildItmCanonicalDocument } from "./canonical";
import { createCanonicalItmJsonSnapshot, loadCanonicalItmJsonSnapshot } from "./json-snapshot";
import { itmCompiledPatternFields, itmDomainRanges, itmPresentationSchema } from "./presentation-schema";
import { itmLayout } from "./layout-schema";
import { abilityEffectsSemanticFieldKey } from "../ie-common/semantic-keys";
import {
    ABILITIES_SECTION,
    buildItmAddAbilityBytes,
    buildItmDuplicateAbilityBytes,
    buildItmDuplicateEffectBytes,
    buildItmInsertAbilityBytes,
    buildItmInsertEffectBytes,
    buildItmRemoveAbilityBytes,
    buildItmRemoveEffectBytes,
    buildItmReorderAbilityBytes,
    buildItmReorderEffectBytes,
    EFFECTS_SECTION,
    isItmRemovableEntry,
    ITM_FIELDS,
} from "./entity-ops";

/** Abilities (and the equipping header range) slice into the shared flat Effects table; orphan effects noted,
 *  and an effect claimed by two ranges is warned (the ability/equipping slices should partition the table). */
const itmCrossRefRelationships: readonly CrossRefRelationship[] = [
    {
        kind: "slice",
        ownerGroup: ABILITIES_SECTION,
        headerGroup: "ITM Header",
        targetGroup: EFFECTS_SECTION,
        sliceNoun: "Effect",
        fields: ITM_FIELDS,
        orphanInfo: true,
        overlapWarn: true,
    },
];

export const itmFormatAdapter: BinaryFormatAdapter = {
    formatId: "itm",
    presentationSchema: itmPresentationSchema,
    compiledPatternFields: itmCompiledPatternFields,
    domainRanges: itmDomainRanges,
    // IE formats cache a rebuildable canonical document (own writable property); clear it on edit.
    documentCacheStrategy: "clear",
    layout: itmLayout,
    crossRefRelationships: itmCrossRefRelationships,

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalItmJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalItmJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildItmCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return abilityEffectsSemanticFieldKey("itm", "ITM Header", segments);
    },

    isRemovableEntry(entryPath: readonly string[]): boolean {
        return isItmRemovableEntry(entryPath);
    },

    buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildItmAddAbilityBytes(parseResult, arrayPath);
        // Effects have no section-level add (owner-ambiguous); return undefined.
        return undefined;
    },

    buildRemoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildItmRemoveAbilityBytes(parseResult, arrayPath, index);
        if (section === EFFECTS_SECTION) return buildItmRemoveEffectBytes(parseResult, arrayPath, index);
        return undefined;
    },

    buildInsertEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildItmInsertAbilityBytes(parseResult, arrayPath, index, position);
        if (section === EFFECTS_SECTION) return buildItmInsertEffectBytes(parseResult, arrayPath, index, position);
        return undefined;
    },

    // The interface method is named "move"; the ITM builders are named "reorder" (entity-ops naming).
    buildMoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildItmReorderAbilityBytes(parseResult, arrayPath, index, direction);
        if (section === EFFECTS_SECTION) return buildItmReorderEffectBytes(parseResult, arrayPath, index, direction);
        return undefined;
    },

    buildDuplicateEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildItmDuplicateAbilityBytes(parseResult, arrayPath, index);
        if (section === EFFECTS_SECTION) return buildItmDuplicateEffectBytes(parseResult, arrayPath, index);
        return undefined;
    },
};
