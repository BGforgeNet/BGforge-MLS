/**
 * Hand-written augmentation of `itmAbilitySpec` with enum / flag lookups.
 * Effect-block target/timing/etc. live in `ie-common/specs/effect.overrides`.
 */

import type { FieldSpec } from "../../spec/types";
import { AbilityIdRequiredFlags, AbilityTargetType, Schools, SecondaryTypes } from "../../ie-common/types";
import {
    ItmAbilityAttackType,
    ItmAbilityDamageType,
    ItmAbilityDepletion,
    ItmAbilityFlags,
    ItmAbilityLocation,
    ItmAbilityProjectileType,
} from "../types";
import { itmAbilitySpec } from "./ability";

export const itmAbilitySpecAnnotated = {
    ...itmAbilitySpec,
    attackType: { ...itmAbilitySpec.attackType, enum: ItmAbilityAttackType },
    idRequired: { ...itmAbilitySpec.idRequired, flags: AbilityIdRequiredFlags },
    location: { ...itmAbilitySpec.location, enum: ItmAbilityLocation },
    target: { ...itmAbilitySpec.target, enum: AbilityTargetType },
    // Primary type / magic school (mschool.2da) and secondary type (msectype.2da); both mod-extensible 2DAs,
    // shared with the SPL header and EFF effect fields of the same name.
    primaryType: { ...itmAbilitySpec.primaryType, enum: Schools, enumOpen: true },
    secondaryType: { ...itmAbilitySpec.secondaryType, enum: SecondaryTypes, enumOpen: true },
    // Three named animation slots per IESDP - overhand / backhand / thrust.
    // Walker emits them as a sub-group with stable per-index labels instead
    // of the opaque "(3 values) padding" array fallback.
    meleeAnimation: {
        ...itmAbilitySpec.meleeAnimation,
        view: "slots" as const,
        slotLabels: ["Overhand", "Backhand", "Thrust"] as const,
    },
    // Open: launcher / projectile values are mod-extensible via ITEMCAT.
    projectileType: { ...itmAbilitySpec.projectileType, enum: ItmAbilityProjectileType, enumOpen: true },
    // Open: per IESDP, damage type values 10+ behave as `None` rather than
    // rejecting, so the engine tolerates out-of-table values.
    damageType: { ...itmAbilitySpec.damageType, enum: ItmAbilityDamageType, enumOpen: true },
    depletion: { ...itmAbilitySpec.depletion, enum: ItmAbilityDepletion },
    flags: { ...itmAbilitySpec.flags, flags: ItmAbilityFlags },
    // Per-ability slice into the global effect table. The values are decided
    // by which effects belong to this ability and where the ability sits in
    // the writer's serialisation order - not user data.
    featureBlockCount: {
        ...itmAbilitySpec.featureBlockCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "effects" } as const,
    },
    featureBlockIndex: {
        ...itmAbilitySpec.featureBlockIndex,
        role: "derivedIndex" as const,
        derivedFrom: { table: "effects" } as const,
    },
} satisfies Record<string, FieldSpec>;

/**
 * Ability display-label overrides. Shared by BOTH the parser (writes the label into the display tree) and the
 * canonical rebuild (looks the field back up by that exact label), so the displayed label and the round-trip
 * lookup key stay identical - a mismatch would break the round-trip. Mirrors `splAbilityPresentation`.
 *
 * - `thac0Bonus` humanizes to "Thac0 Bonus"; THAC0 is an established acronym, so case it correctly.
 * - `idRequired` is a flags field whose own bit is "ID Required"; humanize gives the group legend "Id Required",
 *   which both mis-cases the acronym and reads as a near-duplicate of the bit under it. Relabel the group to
 *   "Identification" (the field selects an identification requirement) so the legend differs from its bits -
 *   the same fix applied to SPL `friendly` -> "Disposition".
 */
export const itmAbilityPresentation = {
    thac0Bonus: { label: "THAC0 Bonus" },
    idRequired: { label: "Identification" },
};
