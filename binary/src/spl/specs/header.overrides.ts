/**
 * Hand-written augmentation of `splHeaderSpec` with IESDP-derived lookups.
 */

import type { FieldSpec } from "../../spec/types";
import { SplCastingGraphics, SplExclusionFlags, SplFlags, SplType } from "../types";
import { splHeaderSpec } from "./header";

export const splHeaderSpecAnnotated = {
    ...splHeaderSpec,
    flags: { ...splHeaderSpec.flags, flags: SplFlags },
    type: { ...splHeaderSpec.type, enum: SplType },
    exclusionFlags: { ...splHeaderSpec.exclusionFlags, flags: SplExclusionFlags },
    castingGraphics: { ...splHeaderSpec.castingGraphics, enum: SplCastingGraphics },
} satisfies Record<string, FieldSpec>;
