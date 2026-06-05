/**
 * SPL structure-op bindings.
 *
 * SPL binds the shared ie-common structure-op factory (createIeStructureOps) with
 * its own effect-range field-config (SPL_FIELDS) and canonical reader/writer. All
 * the byte-builders, EntryCollection descriptors, adapter predicates, and the
 * running-offset relink come from the shared core; this module only injects the
 * SPL-specific dependencies and re-exports the bound members under SPL-named public
 * symbols so the format-adapter can import them.
 *
 * The one piece kept here is defaultSplAbility: the ability field set differs per
 * format, so the default ability cannot be shared. It is zero-constructed from the
 * spec shape - every field assigned its natural zero/empty value:
 * - scalar without flags/enum -> 0
 * - scalar with enum -> 0 (maps to the zero enum member)
 * - scalar with flags -> [] (empty flag array; encodes to wire value 0)
 * - chars field -> "" (NUL-padded to the byte budget on write)
 * This keeps the default independent of any fixture.
 *
 * Field-config note: SPL has two "Offset" fields with different semantics.
 *   - header `featureBlocksOffset` (u32): the effects-section BYTE OFFSET, recomputed
 *     by the writer. Not a range-index field; must NOT be used in SPL_FIELDS.
 *   - header `castingFeatureBlocksOffset` (u16): the casting range START INDEX.
 *   - ability `featureBlocksOffset` (u16): the per-ability range START INDEX.
 * SPL_FIELDS binds headerStart to `castingFeatureBlocksOffset`, never to the header's
 * `featureBlocksOffset`.
 */

import { createIeStructureOps, defaultIeEffect } from "../ie-common/structure-ops";
import type { IeEffectRangeFields } from "../ie-common/effect-partition";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument } from "./canonical-reader";
import { serializeSplCanonicalDocument } from "./canonical-writer";
import type { SplCanonicalDocument } from "./canonical-schemas";

// SplCanonicalDocument["abilities"][number] is SpecData<typeof splAbilitySpecAnnotated>.
// Using the structural array element type directly avoids importing the spec
// annotation just to re-derive what the type already expresses.
type SplAbility = SplCanonicalDocument["abilities"][number];

/**
 * Returns a valid default SPL ability with no owned effects.
 *
 * featureBlocksCount is 0 and featureBlocksOffset is 0; the byte-builder that
 * inserts the ability re-derives the offset via relinkAbilityEffectIndices before
 * serializing, so the placeholder 0 here is corrected to the running offset.
 * Every other field is the zero value for its type. form 0 = SplAbilityForm zero
 * member, location 0 = SplAbilityLocation zero member, target 0 = AbilityTargetType
 * zero member - all valid closed-enum members.
 */
export function defaultSplAbility(): SplAbility {
    return {
        form: 0, // enum (SplAbilityForm) -> 0
        friendly: [], // flags (SplAbilityFriendly); [] encodes to wire 0
        location: 0, // enum (SplAbilityLocation) -> 0
        memorisedIcon: "", // chars(8); NUL-padded to 8 bytes on write
        target: 0, // enum (AbilityTargetType) -> 0
        targetCount: 0,
        range: 0,
        levelRequired: 0,
        castingTime: 0,
        timesPerDay: 0,
        unused1: 0,
        unused2: 0,
        unused3: 0,
        unused4: 0,
        featureBlocksCount: 0,
        featureBlocksOffset: 0,
        unused5: 0,
        unused6: 0,
        projectile: 0,
    };
}

// headerStart binds to castingFeatureBlocksOffset (the casting range start INDEX in the flat effects array), NOT to the
// header's featureBlocksOffset (which is the recomputed effects-section byte offset written by the serializer).
// abilityStart binds to the ability's featureBlocksOffset (its per-ability range start index).
const SPL_FIELDS: IeEffectRangeFields = {
    headerStart: "castingFeatureBlocksOffset",
    headerCount: "castingFeatureBlocksCount",
    abilityStart: "featureBlocksOffset",
    abilityCount: "featureBlocksCount",
};

const ops = createIeStructureOps<SplCanonicalDocument, SplAbility>({
    fields: SPL_FIELDS,
    readDocument: (pr) => getSplCanonicalDocument(pr) ?? rebuildSplCanonicalDocument(pr),
    serialize: serializeSplCanonicalDocument,
    defaultAbility: defaultSplAbility,
    defaultEffect: defaultIeEffect,
});

export const splAbilitiesCollection = ops.abilitiesCollection;
export const splEffectsCollection = ops.effectsCollection;

export const buildSplAddAbilityBytes = ops.buildAddAbilityBytes;
export const buildSplInsertAbilityBytes = ops.buildInsertAbilityBytes;
export const buildSplRemoveAbilityBytes = ops.buildRemoveAbilityBytes;
export const buildSplReorderAbilityBytes = ops.buildReorderAbilityBytes;
export const buildSplDuplicateAbilityBytes = ops.buildDuplicateAbilityBytes;
export const buildSplRemoveEffectBytes = ops.buildRemoveEffectBytes;
export const buildSplInsertEffectBytes = ops.buildInsertEffectBytes;
export const buildSplDuplicateEffectBytes = ops.buildDuplicateEffectBytes;
export const buildSplReorderEffectBytes = ops.buildReorderEffectBytes;

export const isSplListSection = ops.isListSection;
export const isSplModifiableArray = ops.isModifiableArray;
export const isSplAddableArray = ops.isAddableArray;
export const isSplRemovableEntry = ops.isRemovableEntry;

// Re-export the section constants so the format-adapter routes by the same strings the resolvers expect.
export { ABILITIES_SECTION, EFFECTS_SECTION } from "../ie-common/structure-ops";
