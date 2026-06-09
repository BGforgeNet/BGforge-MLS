/**
 * CRE presentation schema. Derived from the augmented header and per-section
 * specs; the item-slot block uses pattern entries (one per slot label).
 */

import type { NumericRange } from "../binary-format-contract";
import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import { effBodySpecAnnotated } from "../eff/specs/body.overrides";
import { toPresentationEntries } from "../spec/derive-presentation";
import { toDomainRanges } from "../spec/derive-domain-ranges";
import { slugify } from "../snapshot-common";
import { creEffectV1Spec } from "./specs/effect-v1";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { creItemSpecAnnotated } from "./specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "./specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "./specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "./specs/spell-mem-info.overrides";
import { CRE_ITEM_SLOT_LABELS, CRE_SELECTED_WEAPON_OPTIONS } from "./types";

// One stable semantic key per slot label so the editor can attach the same
// `int16` editor behaviour regardless of which slot the user clicks. The
// canonical key shape is `cre.itemSlots.<slug>`; pattern coverage would
// over-match (slugs are not regular), so exact keys per slot are used.
// "Selected weapon" is a fixed engine enum (which weapon slot is active, or fists), so it carries the
// weapon-slot option map; the other slots are item-table indices the editor renders as item dropdowns at runtime.
type ItemSlotEntry = {
    label: string;
    editable: boolean;
    presentationType?: "enum";
    enumOptions?: Readonly<Record<string, string>>;
};
const itemSlotEntries: Record<string, ItemSlotEntry> = {};
for (const label of CRE_ITEM_SLOT_LABELS) {
    itemSlotEntries[`cre.itemSlots.${slugify(label)}`] =
        label === "Selected weapon"
            ? { label, editable: true, presentationType: "enum", enumOptions: CRE_SELECTED_WEAPON_OPTIONS }
            : { label, editable: true };
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

// See itm/presentation-schema.ts for rationale; empty until specs declare
// per-field `domain` annotations.
export const creDomainRanges: Readonly<Record<string, NumericRange>> = {
    ...toDomainRanges(creHeaderSpecAnnotated, "cre.header"),
    ...toDomainRanges(creKnownSpellSpecAnnotated, "cre.knownSpells[]"),
    ...toDomainRanges(creSpellMemInfoSpecAnnotated, "cre.spellMemInfo[]"),
    ...toDomainRanges(creMemorizedSpellSpecAnnotated, "cre.memorizedSpells[]"),
    ...toDomainRanges(creItemSpecAnnotated, "cre.items[]"),
    ...toDomainRanges(creEffectV1Spec, "cre.effects[].v1"),
    ...toDomainRanges(effBodySpecAnnotated, "cre.effects[].v2"),
};
