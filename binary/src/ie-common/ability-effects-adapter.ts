/**
 * The format adapter of an IE format whose abilities slice a shared flat effects table (ITM, SPL). Every
 * other layer of those formats is already a binding of an ie-common factory; this is the adapter's.
 */

import type { BinaryFormatAdapter } from "../format-adapter";
import type { ParseOptions, ParseResult } from "../types";
import type { IeEffectRangeFields } from "./effect-partition";
import type { IeJsonSnapshot } from "./json-snapshot";
import { abilityEffectsSemanticFieldKey } from "./semantic-keys";
import { ABILITIES_SECTION, EFFECTS_SECTION, type IeStructureOps } from "./structure-ops";

export interface AbilityEffectsAdapterConfig<Doc, Ability> {
    readonly formatId: string;
    /** The header group, which also owns the effects outside every ability (equipping for ITM, casting for SPL). */
    readonly headerGroup: string;
    readonly presentationSchema: BinaryFormatAdapter["presentationSchema"];
    readonly compiledPatternFields: BinaryFormatAdapter["compiledPatternFields"];
    readonly domainRanges: BinaryFormatAdapter["domainRanges"];
    readonly layout: BinaryFormatAdapter["layout"];
    readonly fields: IeEffectRangeFields;
    readonly snapshot: Pick<IeJsonSnapshot<unknown>, "buildJson" | "createJson" | "loadJson">;
    readonly rebuildCanonicalDocument: (parseResult: ParseResult) => unknown;
    readonly ops: IeStructureOps<Doc, Ability>;
}

export function createAbilityEffectsFormatAdapter<Doc, Ability>(
    config: AbilityEffectsAdapterConfig<Doc, Ability>,
): BinaryFormatAdapter {
    const { ops, snapshot } = config;
    return {
        formatId: config.formatId,
        presentationSchema: config.presentationSchema,
        compiledPatternFields: config.compiledPatternFields,
        domainRanges: config.domainRanges,
        // IE formats cache a rebuildable canonical document (own writable property); clear it on edit.
        documentCacheStrategy: "clear",
        layout: config.layout,
        // Abilities (and the header's own range) slice into the shared flat Effects table; orphan effects are
        // noted, and an effect claimed by two ranges is warned (the slices should partition the table).
        crossRefRelationships: [
            {
                kind: "slice",
                ownerGroup: ABILITIES_SECTION,
                headerGroup: config.headerGroup,
                targetGroup: EFFECTS_SECTION,
                sliceNoun: "Effect",
                fields: config.fields,
                orphanInfo: true,
                overlapWarn: true,
            },
        ],

        buildJsonSnapshot: (parseResult: ParseResult) => snapshot.buildJson(parseResult),
        createJsonSnapshot: (parseResult: ParseResult) => snapshot.createJson(parseResult),
        loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
            const result = snapshot.loadJson(jsonText, parseOptions);
            return { parseResult: result.parseResult, bytes: result.bytes };
        },
        rebuildCanonicalDocument: (parseResult: ParseResult) => config.rebuildCanonicalDocument(parseResult),
        toSemanticFieldKey: (segments: readonly string[]) =>
            abilityEffectsSemanticFieldKey(config.formatId, config.headerGroup, segments),
        isRemovableEntry: (entryPath: readonly string[]) => ops.isRemovableEntry(entryPath),

        buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
            const section = arrayPath[0];
            if (section === ABILITIES_SECTION) return ops.buildAddAbilityBytes(parseResult, arrayPath);
            // A section-level effect add appends an effect of the header's own range (the always-present owner
            // for an effect with no ability), so a record with no effects can gain its first from the empty state.
            if (section === EFFECTS_SECTION) return ops.buildAddEffectBytes(parseResult, arrayPath);
            return undefined;
        },

        buildRemoveEntryBytes(
            parseResult: ParseResult,
            arrayPath: readonly string[],
            index: number,
        ): Uint8Array | undefined {
            const section = arrayPath[0];
            if (section === ABILITIES_SECTION) return ops.buildRemoveAbilityBytes(parseResult, arrayPath, index);
            if (section === EFFECTS_SECTION) return ops.buildRemoveEffectBytes(parseResult, arrayPath, index);
            return undefined;
        },

        buildInsertEntryBytes(
            parseResult: ParseResult,
            arrayPath: readonly string[],
            index: number,
            position: "before" | "after",
        ): Uint8Array | undefined {
            const section = arrayPath[0];
            if (section === ABILITIES_SECTION) {
                return ops.buildInsertAbilityBytes(parseResult, arrayPath, index, position);
            }
            if (section === EFFECTS_SECTION) return ops.buildInsertEffectBytes(parseResult, arrayPath, index, position);
            return undefined;
        },

        // The interface method is named "move"; the structure-op builders are named "reorder".
        buildMoveEntryBytes(
            parseResult: ParseResult,
            arrayPath: readonly string[],
            index: number,
            direction: "up" | "down",
        ): Uint8Array | undefined {
            const section = arrayPath[0];
            if (section === ABILITIES_SECTION) {
                return ops.buildReorderAbilityBytes(parseResult, arrayPath, index, direction);
            }
            if (section === EFFECTS_SECTION)
                return ops.buildReorderEffectBytes(parseResult, arrayPath, index, direction);
            return undefined;
        },

        buildDuplicateEntryBytes(
            parseResult: ParseResult,
            arrayPath: readonly string[],
            index: number,
        ): Uint8Array | undefined {
            const section = arrayPath[0];
            if (section === ABILITIES_SECTION) return ops.buildDuplicateAbilityBytes(parseResult, arrayPath, index);
            if (section === EFFECTS_SECTION) return ops.buildDuplicateEffectBytes(parseResult, arrayPath, index);
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
                return ops.buildAddEffectToAbilityBytes(parseResult, arrayPath, index);
            }
            return undefined;
        },
    };
}
