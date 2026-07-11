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
import { MAX_FILE_SIZES } from "../max-file-sizes";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeCreCanonicalDocument(document: CreCanonicalDocument): Uint8Array {
    const { knownSpells, spellMemInfo, memorizedSpells, effects, items, itemSlots } = document;
    const offsets = computeCreSectionOffsets(document);
    const effectSize = effects.kind === "v1" ? CRE_EFFECT_V1_SIZE : CRE_EFFECT_V2_SIZE;
    const totalSize = offsets.itemSlots + CRE_ITEM_SLOTS_SIZE;

    // An empty section's offset is preserved verbatim from the header (nonEmptyCreSectionOffsets omits it, so
    // enforceDerivedFields leaves it) rather than recomputed. Across the real corpus it almost always already
    // equals the computed in-place position, but a fixture can store a different in-bounds value there (e.g.
    // imoen.cre's empty memorized-spells offset), and preserving it keeps that file byte-exact through a no-op
    // round-trip. A size-shrinking edit (e.g. removing a spell-memorization owner and its slice) can instead
    // leave that preserved offset pointing PAST the new EOF, and the parser rejects `offset > size` even for a
    // zero-length section. Where a preserved empty-section offset is now out of bounds, fall back to the
    // computed in-bounds position; a still-valid offset is left untouched.
    const sectionOffsets = nonEmptyCreSectionOffsets(document, offsets);
    const storedOffsets = {
        knownSpells: document.header.knownSpellsOffset,
        spellMemInfo: document.header.spellMemInfoOffset,
        memorizedSpells: document.header.memorizedSpellsOffset,
        effects: document.header.effectsOffset,
        items: document.header.itemsOffset,
    } as const;
    for (const key of Object.keys(storedOffsets) as (keyof typeof storedOffsets)[]) {
        if (!(key in sectionOffsets) && storedOffsets[key] > totalSize) sectionOffsets[key] = offsets[key];
    }

    const header = enforceDerivedFields(creHeaderSpecAnnotated, document.header, {
        arrays: {
            knownSpells,
            spellMemInfo,
            memorizedSpells,
            effects: effects.records,
            items,
        },
        sectionOffsets,
    });

    // Bound the snapshot's projected expansion to CRE's real-world size envelope BEFORE
    // allocating the output buffer. `totalSize` is driven directly by the JSON snapshot's
    // declared array lengths (knownSpells/spellMemInfo/memorizedSpells/effects/items) and
    // carries no other cap - see max-file-sizes.ts.
    const budget = MAX_FILE_SIZES.cre;
    if (budget !== undefined && totalSize > budget) {
        throw new Error(
            `cre snapshot would expand to ${totalSize} bytes (knownSpells: ${knownSpells.length}, ` +
                `spellMemInfo: ${spellMemInfo.length}, memorizedSpells: ${memorizedSpells.length}, ` +
                `effects: ${effects.records.length}, items: ${items.length}), exceeding the format's ` +
                `${budget} byte budget; refusing to allocate`,
        );
    }

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
