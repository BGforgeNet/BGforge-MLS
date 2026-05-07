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
    // Per-ability slice into the global effect table; not user data. Locked
    // for the same reason as the ITM ability counterparts.
    featureBlocksCount: {
        ...splAbilitySpec.featureBlocksCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "effects" } as const,
    },
    featureBlocksOffset: {
        ...splAbilitySpec.featureBlocksOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "effects" } as const,
    },
} satisfies Record<string, FieldSpec>;
