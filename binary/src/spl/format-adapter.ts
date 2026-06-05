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

    buildRemoveEntryBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildSplRemoveAbilityBytes(parseResult, entryPath);
        if (section === EFFECTS_SECTION) return buildSplRemoveEffectBytes(parseResult, entryPath);
        return undefined;
    },

    buildInsertEntryBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildSplInsertAbilityBytes(parseResult, entryPath, position);
        if (section === EFFECTS_SECTION) return buildSplInsertEffectBytes(parseResult, entryPath, position);
        return undefined;
    },

    // The interface method is named "move"; the SPL builders are named "reorder" (entity-ops naming).
    buildMoveEntryBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildSplReorderAbilityBytes(parseResult, entryPath, direction);
        if (section === EFFECTS_SECTION) return buildSplReorderEffectBytes(parseResult, entryPath, direction);
        return undefined;
    },

    buildDuplicateEntryBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildSplDuplicateAbilityBytes(parseResult, entryPath);
        if (section === EFFECTS_SECTION) return buildSplDuplicateEffectBytes(parseResult, entryPath);
        return undefined;
    },
};
