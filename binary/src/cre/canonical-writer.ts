/**
 * Writer helpers for serialising CreCanonicalDocument back to CRE v1 bytes.
 *
 * Layout order matches what the engine emits and what fixture files use:
 * header, knownSpells, spellMemInfo, memorizedSpells, effects, items,
 * itemSlots. Section offsets are recomputed via `computeCreSectionOffsets`
 * and pushed into the header through `enforceDerivedFields`, so the doc's
 * structural pointers stay in sync regardless of whether the user
 * round-tripped the snapshot or hand-edited it.
 */

import { BufferWriter } from "typed-binary";
import {
    CRE_EFFECT_V1_SIZE,
    CRE_EFFECT_V2_SIZE,
    CRE_ITEM_SIZE,
    CRE_ITEM_SLOTS_SIZE,
    CRE_KNOWN_SPELL_SIZE,
    CRE_MEMORIZED_SPELL_SIZE,
    CRE_SPELL_MEM_INFO_SIZE,
} from "./types";
import {
    computeCreSectionOffsets,
    nonEmptyCreSectionOffsets,
    type CreCanonicalDocument,
    type CreCanonicalSnapshot,
} from "./canonical-schemas";
import {
    creEffectV1Schema,
    creEffectV2Schema,
    creHeaderSchema,
    creItemSchema,
    creKnownSpellSchema,
    creMemorizedSpellSchema,
    creSpellMemInfoSchema,
} from "./schemas";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { enforceDerivedFields } from "../spec/types";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeCreCanonicalDocument(document: CreCanonicalDocument): Uint8Array {
    const { knownSpells, spellMemInfo, memorizedSpells, effects, items, itemSlots } = document;
    const offsets = computeCreSectionOffsets(document);
    const effectSize = effects.kind === "v1" ? CRE_EFFECT_V1_SIZE : CRE_EFFECT_V2_SIZE;

    const header = enforceDerivedFields(creHeaderSpecAnnotated, document.header, {
        arrays: {
            knownSpells,
            spellMemInfo,
            memorizedSpells,
            effects: effects.records,
            items,
        },
        sectionOffsets: nonEmptyCreSectionOffsets(document, offsets),
    });

    const totalSize = offsets.itemSlots + CRE_ITEM_SLOTS_SIZE;
    const out = new Uint8Array(totalSize);

    creHeaderSchema.write(writerAt(out, 0), header);

    for (let i = 0; i < knownSpells.length; i++) {
        creKnownSpellSchema.write(writerAt(out, offsets.knownSpells + i * CRE_KNOWN_SPELL_SIZE), knownSpells[i]!);
    }
    for (let i = 0; i < spellMemInfo.length; i++) {
        creSpellMemInfoSchema.write(
            writerAt(out, offsets.spellMemInfo + i * CRE_SPELL_MEM_INFO_SIZE),
            spellMemInfo[i]!,
        );
    }
    for (let i = 0; i < memorizedSpells.length; i++) {
        creMemorizedSpellSchema.write(
            writerAt(out, offsets.memorizedSpells + i * CRE_MEMORIZED_SPELL_SIZE),
            memorizedSpells[i]!,
        );
    }
    if (effects.kind === "v1") {
        for (let i = 0; i < effects.records.length; i++) {
            creEffectV1Schema.write(writerAt(out, offsets.effects + i * effectSize), effects.records[i]!);
        }
    } else {
        for (let i = 0; i < effects.records.length; i++) {
            creEffectV2Schema.write(writerAt(out, offsets.effects + i * effectSize), effects.records[i]!);
        }
    }
    for (let i = 0; i < items.length; i++) {
        creItemSchema.write(writerAt(out, offsets.items + i * CRE_ITEM_SIZE), items[i]!);
    }
    // itemSlots is a flat i16[40] block; write directly via a DataView so the
    // sentinel value -1 (0xFFFF on the wire for empty slots) round-trips
    // without going through a typed-binary schema for what would amount to
    // forty trivial scalars.
    const slotsView = new DataView(out.buffer, out.byteOffset + offsets.itemSlots, CRE_ITEM_SLOTS_SIZE);
    for (let i = 0; i < itemSlots.length; i++) {
        slotsView.setInt16(i * 2, itemSlots[i]!, true);
    }

    return out;
}

export function serializeCreCanonicalSnapshot(snapshot: CreCanonicalSnapshot): Uint8Array {
    return serializeCreCanonicalDocument(snapshot.document);
}
