/**
 * ITM EntryCollection descriptors and default-element factories for abilities
 * and effects.
 *
 * Approach: zero-construct from the spec shape (approach A). Every field is
 * assigned its natural zero/empty value based on its SpecData projection:
 * - scalar without flags -> 0
 * - scalar with flags -> [] (empty flag array; encodes to wire value 0)
 * - chars field -> "" (NUL-padded to the byte budget on write)
 * - fixed-count array -> number[] of the declared length, all zeros
 *
 * This keeps defaults independent of any fixture - no fixture byte leaks into
 * the default. The alternative (clone-from-parsed) would tie the default to
 * whichever fixture happened to be used, which is a poor user-facing default
 * for a "new ability" workflow.
 *
 * Acceptance gate: a doc with the default ability/effect must serialize via
 * serializeItmCanonicalDocument and reparse without errors, and the default
 * ability must have featureBlockCount === 0. The relink hooks (Tasks 5/6) are
 * left undefined here; the byte-builder callers that need relink come next.
 */

import type { EntryCollection } from "../spec/entity-ops";
import type { ItmCanonicalDocument } from "./canonical-schemas";

// ItmCanonicalDocument["abilities"][number] is SpecData<typeof itmAbilitySpecAnnotated>.
// ItmCanonicalDocument["effects"][number] is SpecData<typeof effectSpecAnnotated>.
// Using the structural array element type directly avoids importing the spec
// annotations just to re-derive what the type already expresses.
type ItmAbility = ItmCanonicalDocument["abilities"][number];
type ItmEffect = ItmCanonicalDocument["effects"][number];

/**
 * Returns a valid default ITM ability with no owned effects.
 *
 * featureBlockCount is 0 and featureBlockIndex is 0; the relink hook in Task 5
 * fixes the index on insert. Every other field is the zero value for its type.
 * attackType 0 = "None", location 0 = "None", target 0 = "Invalid",
 * depletion 0 = "Item remains" - all valid closed-enum members.
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

/**
 * Returns a valid default effect (opcode 0 = "None"), all fields zero/empty.
 */
export function defaultItmEffect(): ItmEffect {
    return {
        opcode: 0,
        target: 0,
        power: 0,
        parameter1: 0,
        parameter2: 0,
        timing: 0,
        resistance: [], // flags field; [] encodes to wire 0
        duration: 0,
        probability1: 0,
        probability2: 0,
        resource: "", // chars(8); NUL-padded to 8 bytes on write
        maxLevel: 0,
        minLevel: 0,
        saveType: [], // flags field; [] encodes to wire 0
        saveBonus: 0,
        stackingIdEx: 0,
    };
}

/**
 * EntryCollection descriptor for ITM abilities.
 *
 * read/write operate on the document-level abilities array. addable and
 * removable are both true because abilities are a standalone ordered list -
 * the relink hook (Task 5) maintains featureBlockIndex/Count on mutations.
 * relink is left undefined here and added in Task 5.
 */
export const itmAbilitiesCollection: EntryCollection<ItmCanonicalDocument, ItmAbility> = {
    read: (doc) => doc.abilities,
    write: (doc, next) => ({ ...doc, abilities: [...next] }),
    defaultElement: defaultItmAbility,
    addable: true,
    removable: true,
    // relink added in Task 5: maintains featureBlockIndex/Count after mutations
};

/**
 * EntryCollection descriptor for ITM effects.
 *
 * addable is false because a new effect has no unambiguous owner: callers
 * would not know which ability's featureBlockIndex/Count to update without
 * additional context. The UI gates "add effect" at the ability level (Task 5/6).
 * removable is true; the relink hook is added in Task 6.
 */
export const itmEffectsCollection: EntryCollection<ItmCanonicalDocument, ItmEffect> = {
    read: (doc) => doc.effects,
    write: (doc, next) => ({ ...doc, effects: [...next] }),
    defaultElement: defaultItmEffect,
    addable: false, // owner-ambiguous: callers must specify the owning ability to add
    removable: true,
    // relink added in Task 6: shifts per-ability featureBlockIndex/Count after removals
};
