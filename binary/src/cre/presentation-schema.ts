/**
 * CRE presentation schema. Derived from the augmented header and per-section
 * specs; the item-slot block uses pattern entries (one per slot label).
 */

import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { effBodySpecAnnotated } from "../eff/specs/body.overrides";
import { toPresentationEntries } from "../spec/derive-presentation";
import { slugify } from "../snapshot-common";
import { creEffectV1Spec } from "./specs/effect-v1";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { creItemSpecAnnotated } from "./specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "./specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "./specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "./specs/spell-mem-info.overrides";
import { CRE_ITEM_SLOT_LABELS } from "./types";

// One stable semantic key per slot label so the editor can attach the same
// `int16` editor behaviour regardless of which slot the user clicks. The
// canonical key shape is `cre.itemSlots.<slug>`; pattern coverage would
// over-match (slugs are not regular), so exact keys per slot are used.
const itemSlotEntries: Record<string, { label: string; editable: boolean }> = {};
for (const label of CRE_ITEM_SLOT_LABELS) {
    itemSlotEntries[`cre.itemSlots.${slugify(label)}`] = { label, editable: true };
}

export const crePresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "cre",
    exactFields: {
        ...toPresentationEntries(creHeaderSpecAnnotated, {}, "cre.header"),
        ...toPresentationEntries(creKnownSpellSpecAnnotated, {}, "cre.knownSpells[]"),
        ...toPresentationEntries(creSpellMemInfoSpecAnnotated, {}, "cre.spellMemInfo[]"),
        ...toPresentationEntries(creMemorizedSpellSpecAnnotated, {}, "cre.memorizedSpells[]"),
        ...toPresentationEntries(creItemSpecAnnotated, {}, "cre.items[]"),
        ...toPresentationEntries(creEffectV1Spec, {}, "cre.effects[].v1"),
        ...toPresentationEntries(effBodySpecAnnotated, {}, "cre.effects[].v2"),
        ...itemSlotEntries,
    },
    patternFields: [],
});

export const creCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    crePresentationSchema.patternFields,
);
