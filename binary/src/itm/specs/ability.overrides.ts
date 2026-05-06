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
    projectileType: { ...itmAbilitySpec.projectileType, enum: ItmAbilityProjectileType },
    damageType: { ...itmAbilitySpec.damageType, enum: ItmAbilityDamageType },
    depletion: { ...itmAbilitySpec.depletion, enum: ItmAbilityDepletion },
    flags: { ...itmAbilitySpec.flags, flags: ItmAbilityFlags },
} satisfies Record<string, FieldSpec>;
