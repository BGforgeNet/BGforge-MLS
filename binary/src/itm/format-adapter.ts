import type { BinaryFormatAdapter } from "../format-adapter";
import type { CrossRefRelationship } from "../cross-ref-relationship";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildItmCanonicalDocument } from "./canonical";
import {
    buildCanonicalItmJsonSnapshot,
    createCanonicalItmJsonSnapshot,
    loadCanonicalItmJsonSnapshot,
} from "./json-snapshot";
import { itmCompiledPatternFields, itmDomainRanges, itmPresentationSchema } from "./presentation-schema";
import { itmLayout } from "./layout-schema";
import { abilityEffectsSemanticFieldKey } from "../ie-common/semantic-keys";
import {
    ABILITIES_SECTION,
    buildItmAddAbilityBytes,
    buildItmAddEffectBytes,
    buildItmAddEffectToAbilityBytes,
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

    buildJsonSnapshot(parseResult: ParseResult): unknown {
        return buildCanonicalItmJsonSnapshot(parseResult);
    },

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
        // A section-level effect add appends a global/equipping effect (the always-present owner for an
        // effect with no ability), so an effect-less item can gain its first effect from the empty state.
        if (section === EFFECTS_SECTION) return buildItmAddEffectBytes(parseResult, arrayPath);
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

    // Owner-scoped effect add: append an effect to a specific ability's slice, so an effect-less ability
    // (new or pre-existing) can gain its first effect, which the flat insert-relative path cannot reach.
    buildAddChildEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        childSection: string,
    ): Uint8Array | undefined {
        if (arrayPath[0] === ABILITIES_SECTION && childSection === EFFECTS_SECTION) {
            return buildItmAddEffectToAbilityBytes(parseResult, arrayPath, index);
        }
        return undefined;
    },
};
