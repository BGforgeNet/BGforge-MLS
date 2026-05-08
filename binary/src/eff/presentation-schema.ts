/**
 * EFF presentation schema. Derived from the augmented body spec.
 */

import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { toPresentationEntries } from "../spec/derive-presentation";
import { effBodySpecAnnotated } from "./specs/body.overrides";

export const effPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "eff",
    exactFields: {
        ...toPresentationEntries(effBodySpecAnnotated, {}, "eff.body"),
    },
    patternFields: [],
});

export const effCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    effPresentationSchema.patternFields,
);
