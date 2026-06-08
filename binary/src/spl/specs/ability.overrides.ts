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

/**
 * Ability display-label overrides. The `friendly` flags field humanizes to "Friendly" - the same word as one
 * of its own two bits (Hostile / Friendly), so the group label reads as a duplicate of a checkbox under it.
 * Relabel the group to "Disposition" (the field selects a hostile vs friendly disposition). Shared by BOTH the
 * parser (writes the display label) and the canonical rebuild (looks the field back up by that label), so the
 * displayed label and the round-trip lookup key stay identical - a mismatch would break the round-trip.
 */
export const splAbilityPresentation = {
    friendly: { label: "Disposition" },
};
