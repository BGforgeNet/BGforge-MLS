/**
 * ITM presentation schema. Derived from the augmented header / ability /
 * effect specs so a new annotation in `<file>.overrides.ts` flows through
 * automatically.
 */

import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { toPresentationEntries } from "../spec/derive-presentation";
import { itmAbilitySpecAnnotated } from "./specs/ability.overrides";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";

export const itmPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "itm",
    exactFields: {
        ...toPresentationEntries(itmHeaderSpecAnnotated, {}, "itm.header"),
        ...toPresentationEntries(itmAbilitySpecAnnotated, {}, "itm.abilities[]"),
        ...toPresentationEntries(effectSpecAnnotated, {}, "itm.effects[]"),
    },
    patternFields: [],
});

export const itmCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    itmPresentationSchema.patternFields,
);
