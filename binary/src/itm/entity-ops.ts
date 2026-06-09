/**
 * ITM structure-op bindings.
 *
 * ITM binds the shared ie-common structure-op factory (createIeStructureOps) with
 * its own effect-range field-config (ITM_FIELDS) and canonical reader/writer. All
 * the byte-builders, EntryCollection descriptors, adapter predicates, and the
 * running-offset relink come from the shared core; this module only injects the
 * ITM-specific dependencies and re-exports the bound members under their existing
 * public names so importers (tests, itm/format-adapter.ts) keep working unchanged.
 *
 * The one piece kept here is defaultItmAbility: the ability field set differs per
 * format, so the default ability cannot be shared. It is zero-constructed from the
 * spec shape (approach A) - every field assigned its natural zero/empty value:
 * - scalar without flags -> 0
 * - scalar with flags -> [] (empty flag array; encodes to wire value 0)
 * - chars field -> "" (NUL-padded to the byte budget on write)
 * - fixed-count array -> number[] of the declared length, all zeros
 * This keeps the default independent of any fixture - no fixture byte leaks into
 * the default. The alternative (clone-from-parsed) would tie the default to
 * whichever fixture happened to be used, which is a poor user-facing default for a
 * "new ability" workflow.
 */

import { ABILITIES_SECTION, createIeStructureOps, defaultIeEffect, EFFECTS_SECTION } from "../ie-common/structure-ops";
import { createEffectPartition, type IeEffectRangeFields } from "../ie-common/effect-partition";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "./canonical-reader";
import { serializeItmCanonicalDocument } from "./canonical-writer";
import type { ItmCanonicalDocument } from "./canonical-schemas";

// ItmCanonicalDocument["abilities"][number] is SpecData<typeof itmAbilitySpecAnnotated>.
// Using the structural array element type directly avoids importing the spec
// annotation just to re-derive what the type already expresses.
type ItmAbility = ItmCanonicalDocument["abilities"][number];

export { ABILITIES_SECTION, EFFECTS_SECTION };

/**
 * Returns a valid default ITM ability with no owned effects.
 *
 * featureBlockCount is 0 and featureBlockIndex is 0; the byte-builder that
 * inserts the ability re-derives the index via relinkAbilityEffectIndices before
 * serializing, so the placeholder 0 here is corrected to the running offset.
 * Every other field is the zero value for its type. attackType 0 = "None",
 * location 0 = "None", target 0 = "Invalid", depletion 0 = "Item remains" - all
 * valid closed-enum members.
 */
export function defaultItmAbility(): ItmAbility {
    return {
        attackType: 0,
        idRequired: [], // flags field; [] encodes to wire 0
        location: 0,
        alternativeDiceSides: 0,
        useIcon: "", // chars(8); NUL-padded to 8 bytes on write
        target: 0,
        targetCount: 0,
        range: 0,
        projectileType: 0,
        alternativeDiceThrown: 0,
        speed: 0,
        alternativeDamageBonus: 0,
        thac0Bonus: 0,
        diceSides: 0,
        primaryType: 0,
        diceThrown: 0,
        secondaryType: 0,
        damageBonus: 0,
        damageType: 0,
        featureBlockCount: 0,
        featureBlockIndex: 0,
        maxCharges: 0,
        depletion: 0,
        flags: [], // flags field; [] encodes to wire 0
        projectileAnimation: 0,
        meleeAnimation: [0, 0, 0], // fixed-count array, count 3
        isArrow: 0,
        isBolt: 0,
        isBullet: 0,
    };
}

// defaultItmEffect is now the shared default; keep the name for existing importers.
export const defaultItmEffect = defaultIeEffect;

export const ITM_FIELDS: IeEffectRangeFields = {
    headerStart: "featureBlocksIndex",
    headerCount: "featureBlocksCount",
    abilityStart: "featureBlockIndex",
    abilityCount: "featureBlockCount",
};

const ops = createIeStructureOps<ItmCanonicalDocument, ItmAbility>({
    fields: ITM_FIELDS,
    readDocument: (pr) => getItmCanonicalDocument(pr) ?? rebuildItmCanonicalDocument(pr),
    serialize: serializeItmCanonicalDocument,
    defaultAbility: defaultItmAbility,
    defaultEffect: defaultIeEffect,
});

// validateEffectPartition was previously imported by itm-entity-ops.test.ts from itm/effect-partition;
// re-export the ITM-bound instance so that import has a stable home after that module is deleted.
export const { validateEffectPartition } = createEffectPartition(ITM_FIELDS);

export const itmAbilitiesCollection = ops.abilitiesCollection;
export const itmEffectsCollection = ops.effectsCollection;
export const relinkAbilityEffectIndices = ops.relinkAbilityEffectIndices;

export const buildItmAddAbilityBytes = ops.buildAddAbilityBytes;
export const buildItmInsertAbilityBytes = ops.buildInsertAbilityBytes;
export const buildItmRemoveAbilityBytes = ops.buildRemoveAbilityBytes;
export const buildItmReorderAbilityBytes = ops.buildReorderAbilityBytes;
export const buildItmDuplicateAbilityBytes = ops.buildDuplicateAbilityBytes;
export const buildItmRemoveEffectBytes = ops.buildRemoveEffectBytes;
export const buildItmInsertEffectBytes = ops.buildInsertEffectBytes;
export const buildItmDuplicateEffectBytes = ops.buildDuplicateEffectBytes;
export const buildItmReorderEffectBytes = ops.buildReorderEffectBytes;

export const isItmListSection = ops.isListSection;
export const isItmModifiableArray = ops.isModifiableArray;
export const isItmAddableArray = ops.isAddableArray;
export const isItmRemovableEntry = ops.isRemovableEntry;
