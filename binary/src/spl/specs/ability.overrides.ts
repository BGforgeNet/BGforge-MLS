/**
 * Hand-written augmentation of `splAbilitySpec` with IESDP lookups.
 */

import type { FieldSpec } from "../../spec/types";
import { AbilityProjectileNone, AbilityTargetType, PROJECTILE_REF } from "../../ie-common/types";
import { SplAbilityForm, SplAbilityFriendly, SplAbilityLocation } from "../types";
import { splAbilitySpec } from "./ability";

export const splAbilitySpecAnnotated = {
    ...splAbilitySpec,
    // Hand-declared resref target (IESDP's prose is not a reliable source).
    memorisedIcon: { ...splAbilitySpec.memorisedIcon, ref: { kind: "resource", type: "BAM" } },
    form: { ...splAbilitySpec.form, enum: SplAbilityForm },
    friendly: { ...splAbilitySpec.friendly, flags: SplAbilityFriendly },
    location: { ...splAbilitySpec.location, enum: SplAbilityLocation },
    target: { ...splAbilitySpec.target, enum: AbilityTargetType },
    // Named by MISSILE.IDS and PROJECTL.IDS together - see PROJECTILE_REF for the keying and why both. The
    // vendored pair covers only the two values below their key space; every projectile comes from the install.
    projectile: { ...splAbilitySpec.projectile, enum: AbilityProjectileNone, enumOpen: true, ref: PROJECTILE_REF },
    // Six reserved slots: real wire bytes that round-trip, but no user-editable data. Hide them from the
    // ability detail form (the rebuilder reads them back by label, so the byte round-trip is unaffected).
    unused1: { ...splAbilitySpec.unused1, hidden: true },
    unused2: { ...splAbilitySpec.unused2, hidden: true },
    unused3: { ...splAbilitySpec.unused3, hidden: true },
    unused4: { ...splAbilitySpec.unused4, hidden: true },
    unused5: { ...splAbilitySpec.unused5, hidden: true },
    unused6: { ...splAbilitySpec.unused6, hidden: true },
    // Per-ability slice into the global effect table; not user data. Locked and partition-owned for the same
    // reason as the ITM ability counterparts - `featureBlocksOffset` is this range's START INDEX, not a byte
    // offset (see spl/entity-ops.ts).
    featureBlocksCount: {
        ...splAbilitySpec.featureBlocksCount,
        role: "reserved" as const,
    },
    featureBlocksOffset: {
        ...splAbilitySpec.featureBlocksOffset,
        role: "reserved" as const,
    },
} satisfies Record<string, FieldSpec>;

/**
 * Ability display-label overrides. The `friendly` flags field humanizes to "Friendly" - the same word as one
 * of its own two bits (Hostile / Friendly), so the group label reads as a duplicate of a checkbox under it.
 * Relabel the group to "Disposition" (the field selects a hostile vs friendly disposition). Shared by BOTH the
 * parser (writes the display label) and the canonical rebuild (looks the field back up by that label), so the
 * displayed label and the round-trip lookup key stay identical - a mismatch would break the round-trip.
 *
 * The six reserved `unused*` slots are hidden from the form (see `splAbilitySpecAnnotated`), so they need no
 * display labels here - they round-trip via their default humanized label, which parser and rebuild share.
 */
export const splAbilityPresentation = {
    friendly: { label: "Disposition" },
};
