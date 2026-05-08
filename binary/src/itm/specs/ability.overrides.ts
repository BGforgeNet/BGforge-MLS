/**
 * Hand-written augmentation of `itmAbilitySpec` with enum / flag lookups.
 * Effect-block target/timing/etc. live in `ie-common/specs/effect.overrides`.
 */

import type { FieldSpec } from "../../spec/types";
import { AbilityIdRequiredFlags, AbilityTargetType } from "../../ie-common/types";
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
