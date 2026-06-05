/**
 * CRE canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`).
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import { parseWithSchemaValidation } from "../schema-validation";
import { structFromDisplayFull } from "../ie-common/rebuild-ability-effects";
import { effBodySpecAnnotated } from "../eff/specs/body.overrides";
import { creEffectV1Spec } from "./specs/effect-v1";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { creItemSpecAnnotated } from "./specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "./specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "./specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "./specs/spell-mem-info.overrides";
import { CRE_GROUP_LABELS, CRE_ITEM_SLOT_LABELS } from "./types";
import {
    type CreCanonicalDocument,
    type CreCanonicalSnapshot,
    creCanonicalDocumentSchemaPermissive,
    creCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParsedField, ParsedGroup, ParseResult } from "../types";

// -- Group-finding helpers ---------------------------------------------------

function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return "fields" in entry;
}

function getGroup(root: ParsedGroup, name: string): ParsedGroup {
    const found = root.fields.find((e): e is ParsedGroup => isGroup(e) && e.name === name);
    if (!found) throw new Error(`Missing CRE group: "${name}" in "${root.name}"`);
    return found;
}

function getChildGroups(parent: ParsedGroup): ParsedGroup[] {
    return parent.fields.filter((e): e is ParsedGroup => isGroup(e));
}

// -- Rebuild -----------------------------------------------------------------

/**
 * Rebuild a CRE canonical document from the display tree when
 * `result.document` is absent (i.e. the editor has modified the display tree
 * and not yet re-parsed from bytes).
 *
 * Sections:
 *   - Header: one struct rebuilt via `structFromDisplayFull` (handles the
 *     three `view:"slots"` arrays: `proficiencies`, `soundSlots`, `objectRefs`).
 *   - Known spells, spell-mem-info, memorized spells, items: each section is
 *     a group of child groups; each child is rebuilt via `structFromDisplayFull`.
 *   - Effects: dispatched on `effStructureVersion` recovered from the header.
 *     Version 0 uses `creEffectV1Spec`; version 1 uses `effBodySpecAnnotated`.
 *     Both specs are flat (scalars + chars), so `structFromDisplayFull` handles
 *     them in the scalar+chars path with no array special-cases beyond
 *     `effBodySpecAnnotated.unused7` (15 x u32 padding, zero-filled on rebuild).
 *   - Item slots: the "Item Slots" group is a flat list of ParsedField entries
 *     labelled per `CRE_ITEM_SLOT_LABELS`; read each by label in slot order.
 */
function rebuildCreFromDisplay(result: ParseResult): CreCanonicalDocument {
    const fileGroup = result.root;

    const headerGroup = getGroup(fileGroup, CRE_GROUP_LABELS.header);
    const knownSpellsGroup = getGroup(fileGroup, CRE_GROUP_LABELS.knownSpells);
    const spellMemInfoGroup = getGroup(fileGroup, CRE_GROUP_LABELS.spellMemInfo);
    const memorizedSpellsGroup = getGroup(fileGroup, CRE_GROUP_LABELS.memorizedSpells);
    const effectsGroup = getGroup(fileGroup, CRE_GROUP_LABELS.effects);
    const itemsGroup = getGroup(fileGroup, CRE_GROUP_LABELS.items);
    const itemSlotsGroup = getGroup(fileGroup, CRE_GROUP_LABELS.itemSlots);

    const header = structFromDisplayFull(headerGroup, creHeaderSpecAnnotated, {});

    const knownSpells = getChildGroups(knownSpellsGroup).map((g) =>
        structFromDisplayFull(g, creKnownSpellSpecAnnotated, {}),
    );

    const spellMemInfo = getChildGroups(spellMemInfoGroup).map((g) =>
        structFromDisplayFull(g, creSpellMemInfoSpecAnnotated, {}),
    );

    const memorizedSpells = getChildGroups(memorizedSpellsGroup).map((g) =>
        structFromDisplayFull(g, creMemorizedSpellSpecAnnotated, {}),
    );

    const items = getChildGroups(itemsGroup).map((g) => structFromDisplayFull(g, creItemSpecAnnotated, {}));

    // Dispatch effects on the version recovered from the rebuilt header.
    // header.effStructureVersion is the closed enum (0 or 1); the same branch
    // the parser uses is reproduced here to guarantee consistent dispatch.
    const effectKind: "v1" | "v2" = header.effStructureVersion === 0 ? "v1" : "v2";
    const effects =
        effectKind === "v1"
            ? {
                  kind: "v1" as const,
                  records: getChildGroups(effectsGroup).map((g) => structFromDisplayFull(g, creEffectV1Spec, {})),
              }
            : {
                  kind: "v2" as const,
                  records: getChildGroups(effectsGroup).map((g) => structFromDisplayFull(g, effBodySpecAnnotated, {})),
              };

    // Item slots: flat ParsedField entries in CRE_ITEM_SLOT_LABELS order.
    // The display layer emits one i16 field per slot with the slot label as the
    // field name. Read them by label to stay resilient to future reordering.
    const slotByLabel = new Map<string, ParsedField>();
    for (const entry of itemSlotsGroup.fields) {
        if (!isGroup(entry)) slotByLabel.set(entry.name, entry);
    }
    const itemSlots: number[] = CRE_ITEM_SLOT_LABELS.map((label) => {
        const f = slotByLabel.get(label);
        if (!f) throw new Error(`Missing item slot field "${label}" in "${CRE_GROUP_LABELS.itemSlots}"`);
        const raw = typeof f.rawValue === "number" ? f.rawValue : typeof f.value === "number" ? f.value : undefined;
        if (typeof raw !== "number") throw new TypeError(`Item slot "${label}" had no numeric rawValue/value`);
        return raw;
    });

    const raw = { header, knownSpells, spellMemInfo, memorizedSpells, effects, items, itemSlots };
    return parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, raw, "Invalid CRE canonical document");
}

const reader = createIeCanonicalReader<CreCanonicalDocument, CreCanonicalSnapshot>({
    formatId: "cre",
    formatLabel: "CRE",
    documentSchemaPermissive: creCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: creCanonicalSnapshotSchemaPermissive,
    rebuildFromDisplay: rebuildCreFromDisplay,
});

export const getCreCanonicalDocument = reader.getDocument;
export const rebuildCreCanonicalDocument = reader.rebuildDocument;
export const createCreCanonicalSnapshot = reader.createSnapshot;
