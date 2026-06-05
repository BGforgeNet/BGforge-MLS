import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import { rebuildItmCanonicalDocument } from "./canonical";
import { createCanonicalItmJsonSnapshot, loadCanonicalItmJsonSnapshot } from "./json-snapshot";
import { itmCompiledPatternFields, itmDomainRanges, itmPresentationSchema } from "./presentation-schema";
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
    isItmAddableArray,
    isItmListSection,
    isItmModifiableArray,
    isItmRemovableEntry,
} from "./entity-ops";

export const itmFormatAdapter: BinaryFormatAdapter = {
    formatId: "itm",
    presentationSchema: itmPresentationSchema,
    compiledPatternFields: itmCompiledPatternFields,
    domainRanges: itmDomainRanges,

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

    isListSection(arrayPath: readonly string[]): boolean {
        return isItmListSection(arrayPath);
    },

    isModifiableArray(arrayPath: readonly string[]): boolean {
        return isItmModifiableArray(arrayPath);
    },

    isAddableArray(arrayPath: readonly string[]): boolean {
        return isItmAddableArray(arrayPath);
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

    buildRemoveEntryBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildItmRemoveAbilityBytes(parseResult, entryPath);
        if (section === EFFECTS_SECTION) return buildItmRemoveEffectBytes(parseResult, entryPath);
        return undefined;
    },

    buildInsertEntryBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        position: "before" | "after",
    ): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildItmInsertAbilityBytes(parseResult, entryPath, position);
        if (section === EFFECTS_SECTION) return buildItmInsertEffectBytes(parseResult, entryPath, position);
        return undefined;
    },

    // The interface method is named "move"; the ITM builders are named "reorder" (entity-ops naming).
    buildMoveEntryBytes(
        parseResult: ParseResult,
        entryPath: readonly string[],
        direction: "up" | "down",
    ): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildItmReorderAbilityBytes(parseResult, entryPath, direction);
        if (section === EFFECTS_SECTION) return buildItmReorderEffectBytes(parseResult, entryPath, direction);
        return undefined;
    },

    buildDuplicateEntryBytes(parseResult: ParseResult, entryPath: readonly string[]): Uint8Array | undefined {
        const section = entryPath[0];
        if (section === ABILITIES_SECTION) return buildItmDuplicateAbilityBytes(parseResult, entryPath);
        if (section === EFFECTS_SECTION) return buildItmDuplicateEffectBytes(parseResult, entryPath);
        return undefined;
    },
};
