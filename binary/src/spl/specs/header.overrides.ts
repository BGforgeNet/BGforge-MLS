/**
 * Hand-written augmentation of `splHeaderSpec` with IESDP-derived lookups.
 */

import type { FieldSpec } from "../../spec/types";
import { SCHOOL_REF, Schools, SECTYPE_REF, SecondaryTypes } from "../../ie-common/types";
import { SplCastingGraphics, SplExclusionFlags, SplFlags, SplType } from "../types";
import { splHeaderSpec } from "./header";

export const splHeaderSpecAnnotated = {
    ...splHeaderSpec,
    // Hand-declared resref targets (IESDP's prose is not a reliable source). `unused16`/`unused19` stay
    // undeclared: IESDP marks them unused and they name nothing.
    completionSound: { ...splHeaderSpec.completionSound, ref: { kind: "resource", type: "WAV" } },
    spellbookIcon: { ...splHeaderSpec.spellbookIcon, ref: { kind: "resource", type: "BAM" } },
    flags: { ...splHeaderSpec.flags, flags: SplFlags },
    // Per IESDP, type values 6-65535 behave as Psionic/Bard-song; the engine
    // tolerates out-of-table values, so the lookup is advisory.
    type: { ...splHeaderSpec.type, enum: SplType, enumOpen: true },
    // Primary type / magic school (mschool.2da). Open because the 2DA is mod-extensible.
    school: { ...splHeaderSpec.school, enum: Schools, enumOpen: true, ref: SCHOOL_REF },
    // Secondary type (msectype.2da), likewise mod-extensible.
    sectype: { ...splHeaderSpec.sectype, enum: SecondaryTypes, enumOpen: true, ref: SECTYPE_REF },
    exclusionFlags: { ...splHeaderSpec.exclusionFlags, flags: SplExclusionFlags },
    // Casting graphics 0-15 are documented; mods/EE engines occasionally use
    // additional values.
    castingGraphics: { ...splHeaderSpec.castingGraphics, enum: SplCastingGraphics, enumOpen: true },
    // Structural pointers into the abilities + effects sections that follow
    // the header. Editing these by hand silently corrupts the file; the
    // editor renders them as read-only via the `role` annotation. The casting
    // (global) feature-block subset uses its own offset/count pair.
    extendedHeadersOffset: {
        ...splHeaderSpec.extendedHeadersOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "abilities" } as const,
    },
    extendedHeadersCount: {
        ...splHeaderSpec.extendedHeadersCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "abilities" } as const,
    },
    featureBlocksOffset: {
        ...splHeaderSpec.featureBlocksOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "effects" } as const,
    },
    // Renamed from `castingFeatureBlocksOffset` per IESDP (it is, and always was, the casting-range START
    // INDEX into the flat effects array - see spl/entity-ops.ts - not a byte offset). The casting range's
    // start and size are owned by the effect partition (ie-common/effect-partition.ts, via entity-ops), not by
    // the write-time recompute: there is no `castingEffects` array or section for it to read, and the count is
    // the casting subset's size rather than the total. `reserved` states that and keeps the editor lock.
    castingFeatureBlocksIndex: {
        ...splHeaderSpec.castingFeatureBlocksIndex,
        role: "reserved" as const,
    },
    castingFeatureBlocksCount: {
        ...splHeaderSpec.castingFeatureBlocksCount,
        role: "reserved" as const,
    },
} satisfies Record<string, FieldSpec>;
