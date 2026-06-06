import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildSplCanonicalDocument } from "./canonical";
import { createCanonicalSplJsonSnapshot, loadCanonicalSplJsonSnapshot } from "./json-snapshot";
import { splCompiledPatternFields, splDomainRanges, splPresentationSchema } from "./presentation-schema";
import { abilityEffectsSemanticFieldKey } from "../ie-common/semantic-keys";
import {
    ABILITIES_SECTION,
    buildSplAddAbilityBytes,
    buildSplDuplicateAbilityBytes,
    buildSplDuplicateEffectBytes,
    buildSplInsertAbilityBytes,
    buildSplInsertEffectBytes,
    buildSplRemoveAbilityBytes,
    buildSplRemoveEffectBytes,
    buildSplReorderAbilityBytes,
    buildSplReorderEffectBytes,
    EFFECTS_SECTION,
    isSplAddableArray,
    isSplListSection,
    isSplModifiableArray,
    isSplRemovableEntry,
} from "./entity-ops";

export const splFormatAdapter: BinaryFormatAdapter = {
    formatId: "spl",
    presentationSchema: splPresentationSchema,
    compiledPatternFields: splCompiledPatternFields,
    domainRanges: splDomainRanges,
    // IE formats cache a rebuildable canonical document (own writable property); clear it on edit.
    documentCacheStrategy: "clear",

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

    isListSection(arrayPath: readonly string[]): boolean {
        return isSplListSection(arrayPath);
    },

    isModifiableArray(arrayPath: readonly string[]): boolean {
        return isSplModifiableArray(arrayPath);
    },

    isAddableArray(arrayPath: readonly string[]): boolean {
        return isSplAddableArray(arrayPath);
    },

    isRemovableEntry(entryPath: readonly string[]): boolean {
        return isSplRemovableEntry(entryPath);
    },

    buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
        const section = arrayPath[0];
        if (section === ABILITIES_SECTION) return buildSplAddAbilityBytes(parseResult, arrayPath);
        // Effects have no section-level add (owner-ambiguous); return undefined.
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
};
