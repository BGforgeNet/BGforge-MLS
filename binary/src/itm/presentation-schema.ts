/**
 * ITM presentation schema. Derived from the augmented header / ability /
 * effect specs so a new annotation in `<file>.overrides.ts` flows through
 * automatically.
 */

import type { NumericRange } from "../binary-format-contract";
import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { effectPresentation, effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { toPresentationEntries } from "../spec/derive-presentation";
import { toDomainRanges } from "../spec/derive-domain-ranges";
import { itmAbilityPresentation, itmAbilitySpecAnnotated } from "./specs/ability.overrides";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";

export const itmPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "itm",
    exactFields: {
        ...toPresentationEntries(itmHeaderSpecAnnotated, {}, "itm.header"),
        ...toPresentationEntries(itmAbilitySpecAnnotated, itmAbilityPresentation, "itm.abilities[]"),
        ...toPresentationEntries(effectSpecAnnotated, effectPresentation, "itm.effects[]"),
    },
    patternFields: [],
});

export const itmCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    itmPresentationSchema.patternFields,
);

// Per-field numeric clamp bounds, derived from `domain:` annotations on the
// underlying specs. Empty until specs start declaring domains; the table is
// wired through the format adapter so a new `domain` annotation flows into
// validateNumericValue / the editor's range UI automatically.
export const itmDomainRanges: Readonly<Record<string, NumericRange>> = {
    ...toDomainRanges(itmHeaderSpecAnnotated, "itm.header"),
    ...toDomainRanges(itmAbilitySpecAnnotated, "itm.abilities[]"),
    ...toDomainRanges(effectSpecAnnotated, "itm.effects[]"),
};
