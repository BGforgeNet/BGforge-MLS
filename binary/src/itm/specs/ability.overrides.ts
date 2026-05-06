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
    // Open: launcher / projectile values are mod-extensible via ITEMCAT.
    projectileType: { ...itmAbilitySpec.projectileType, enum: ItmAbilityProjectileType, enumOpen: true },
    // Open: per IESDP, damage type values 10+ behave as `None` rather than
    // rejecting, so the engine tolerates out-of-table values.
    damageType: { ...itmAbilitySpec.damageType, enum: ItmAbilityDamageType, enumOpen: true },
    depletion: { ...itmAbilitySpec.depletion, enum: ItmAbilityDepletion },
    flags: { ...itmAbilitySpec.flags, flags: ItmAbilityFlags },
} satisfies Record<string, FieldSpec>;
