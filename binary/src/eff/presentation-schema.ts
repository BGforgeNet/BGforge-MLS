/**
 * EFF presentation schema. Derived from the augmented body spec.
 */

import type { NumericRange } from "../binary-format-contract";
import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { toPresentationEntries } from "../spec/derive-presentation";
import { toDomainRanges } from "../spec/derive-domain-ranges";
import { effBodySpecAnnotated, effBodyPresentation } from "./specs/body.overrides";

export const effPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "eff",
    exactFields: {
        ...toPresentationEntries(effBodySpecAnnotated, effBodyPresentation, "eff.body"),
    },
    patternFields: [],
});

export const effCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    effPresentationSchema.patternFields,
);

// See itm/presentation-schema.ts for rationale; empty until specs declare
// per-field `domain` annotations.
export const effDomainRanges: Readonly<Record<string, NumericRange>> = {
    ...toDomainRanges(effBodySpecAnnotated, "eff.body"),
};
