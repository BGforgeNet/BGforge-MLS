/**
 * Hand-written augmentation of `splAbilitySpec` with IESDP lookups.
 */

import type { FieldSpec } from "../../spec/types";
import { AbilityTargetType } from "../../ie-common/types";
import { SplAbilityForm, SplAbilityFriendly, SplAbilityLocation } from "../types";
import { splAbilitySpec } from "./ability";

export const splAbilitySpecAnnotated = {
    ...splAbilitySpec,
    form: { ...splAbilitySpec.form, enum: SplAbilityForm },
    friendly: { ...splAbilitySpec.friendly, flags: SplAbilityFriendly },
    location: { ...splAbilitySpec.location, enum: SplAbilityLocation },
    target: { ...splAbilitySpec.target, enum: AbilityTargetType },
} satisfies Record<string, FieldSpec>;
