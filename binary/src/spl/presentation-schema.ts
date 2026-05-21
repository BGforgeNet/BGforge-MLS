/**
 * SPL presentation schema. Derived from the augmented header / ability /
 * effect specs.
 */

import type { NumericRange } from "../binary-format-contract";
import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { toPresentationEntries } from "../spec/derive-presentation";
import { toDomainRanges } from "../spec/derive-domain-ranges";
import { splAbilitySpecAnnotated } from "./specs/ability.overrides";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";

export const splPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "spl",
    exactFields: {
        ...toPresentationEntries(splHeaderSpecAnnotated, {}, "spl.header"),
        ...toPresentationEntries(splAbilitySpecAnnotated, {}, "spl.abilities[]"),
        ...toPresentationEntries(effectSpecAnnotated, {}, "spl.effects[]"),
    },
    patternFields: [],
});

export const splCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    splPresentationSchema.patternFields,
);

// See itm/presentation-schema.ts for rationale; empty until specs declare
// per-field `domain` annotations.
export const splDomainRanges: Readonly<Record<string, NumericRange>> = {
    ...toDomainRanges(splHeaderSpecAnnotated, "spl.header"),
    ...toDomainRanges(splAbilitySpecAnnotated, "spl.abilities[]"),
    ...toDomainRanges(effectSpecAnnotated, "spl.effects[]"),
};
