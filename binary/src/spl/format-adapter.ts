import type { BinaryFormatAdapter } from "../format-adapter";
import type { CrossRefRelationship } from "../cross-ref-relationship";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildSplCanonicalDocument } from "./canonical";
import {
    buildCanonicalSplJsonSnapshot,
    createCanonicalSplJsonSnapshot,
    loadCanonicalSplJsonSnapshot,
} from "./json-snapshot";
import { splCompiledPatternFields, splDomainRanges, splPresentationSchema } from "./presentation-schema";
import { splLayout } from "./layout-schema";
import { abilityEffectsSemanticFieldKey } from "../ie-common/semantic-keys";
import {
    ABILITIES_SECTION,
    buildSplAddAbilityBytes,
    buildSplAddEffectBytes,
    buildSplAddEffectToAbilityBytes,
    buildSplDuplicateAbilityBytes,
    buildSplDuplicateEffectBytes,
    buildSplInsertAbilityBytes,
    buildSplInsertEffectBytes,
    buildSplRemoveAbilityBytes,
    buildSplRemoveEffectBytes,
    buildSplReorderAbilityBytes,
    buildSplReorderEffectBytes,
    EFFECTS_SECTION,
    isSplRemovableEntry,
    SPL_FIELDS,
} from "./entity-ops";

/** Abilities (and the casting header range) slice into the shared flat Effects table; orphan effects noted,
 *  and an effect claimed by two ranges is warned (the ability/casting slices should partition the table). */
const splCrossRefRelationships: readonly CrossRefRelationship[] = [
    {
        kind: "slice",
        ownerGroup: ABILITIES_SECTION,
        headerGroup: "SPL Header",
        targetGroup: EFFECTS_SECTION,
        sliceNoun: "Effect",
        fields: SPL_FIELDS,
        orphanInfo: true,
        overlapWarn: true,
    },
];

export const splFormatAdapter: BinaryFormatAdapter = {
    formatId: "spl",
    presentationSchema: splPresentationSchema,
    compiledPatternFields: splCompiledPatternFields,
    domainRanges: splDomainRanges,
    // IE formats cache a rebuildable canonical document (own writable property); clear it on edit.
    documentCacheStrategy: "clear",
    layout: splLayout,
    crossRefRelationships: splCrossRefRelationships,

    buildJsonSnapshot(parseResult: ParseResult): unknown {
        return buildCanonicalSplJsonSnapshot(parseResult);
    },

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalSplJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalSplJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildSplCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return abilityEffectsSemanticFieldKey("spl", "SPL Header", segments);
    },

    isRemovableEntry(entryPath: readonly string[]): boolean {
        return isSplRemovableEntry(entryPath);
    },

    buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildSplAddAbilityBytes(parseResult, arrayPath);
        // A section-level effect add appends a global/casting effect (the always-present owner for an
        // effect with no ability), so an effect-less spell can gain its first effect from the empty state.
        if (section === EFFECTS_SECTION) return buildSplAddEffectBytes(parseResult, arrayPath);
        return undefined;
    },

    buildRemoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildSplRemoveAbilityBytes(parseResult, arrayPath, index);
        if (section === EFFECTS_SECTION) return buildSplRemoveEffectBytes(parseResult, arrayPath, index);
        return undefined;
    },

    buildInsertEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildSplInsertAbilityBytes(parseResult, arrayPath, index, position);
        if (section === EFFECTS_SECTION) return buildSplInsertEffectBytes(parseResult, arrayPath, index, position);
        return undefined;
    },

    // The interface method is named "move"; the SPL builders are named "reorder" (entity-ops naming).
    buildMoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildSplReorderAbilityBytes(parseResult, arrayPath, index, direction);
        if (section === EFFECTS_SECTION) return buildSplReorderEffectBytes(parseResult, arrayPath, index, direction);
        return undefined;
    },

    buildDuplicateEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
    ): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildSplDuplicateAbilityBytes(parseResult, arrayPath, index);
        if (section === EFFECTS_SECTION) return buildSplDuplicateEffectBytes(parseResult, arrayPath, index);
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
            return buildSplAddEffectToAbilityBytes(parseResult, arrayPath, index);
        }
        return undefined;
    },
};
