/**
 * SPL presentation schema. Derived from the augmented header / ability /
 * effect specs.
 */

import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { toPresentationEntries } from "../spec/derive-presentation";
import { splAbilitySpecAnnotated } from "./specs/ability.overrides";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";
import type { NumericRange } from "../binary-format-contract";

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

export const splDomainRanges: Readonly<Record<string, NumericRange>> = {};
