/**
 * Writer helpers for serialising ItmCanonicalDocument back to ITM v1 bytes.
 *
 * Recomputes the derived header fields (`extendedHeadersOffset/Count`,
 * `featureBlocksOffset`) from the doc shape via `enforceDerivedFields` —
 * a hand-edited canonical doc with stale or wrong offsets cannot produce
 * a corrupt file; the recompute fills in the truth. `featureBlocksIndex`
 * and `featureBlocksCount` encode the *equipping* effect subset (per IESDP
 * + parser comment in `itm/index.ts`), which the writer has no derivation
 * source for, so those values pass through as the user supplied them.
 */

import { BufferWriter } from "typed-binary";
import { itmAbilitySchema, effectSchema, itmHeaderSchema } from "./schemas";
import { EFFECT_SIZE } from "../ie-common/types";
import { ITM_ABILITY_SIZE, ITM_HEADER_SIZE } from "./types";
import { type ItmCanonicalDocument, type ItmCanonicalSnapshot } from "./canonical-schemas";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";
import { enforceDerivedFields } from "../spec/types";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeItmCanonicalDocument(document: ItmCanonicalDocument): Uint8Array {
    const { abilities, effects } = document;
    const abilitiesOffset = ITM_HEADER_SIZE;
    const effectsOffset = abilitiesOffset + abilities.length * ITM_ABILITY_SIZE;
    const header = enforceDerivedFields(itmHeaderSpecAnnotated, document.header, {
        arrays: { abilities },
        sectionOffsets: { abilities: abilitiesOffset, effects: effectsOffset },
    });

    const totalSize = Math.max(
        ITM_HEADER_SIZE,
        abilitiesOffset + abilities.length * ITM_ABILITY_SIZE,
        effectsOffset + effects.length * EFFECT_SIZE,
    );

    const out = new Uint8Array(totalSize);
    itmHeaderSchema.write(writerAt(out, 0), header);

    for (let i = 0; i < abilities.length; i++) {
        itmAbilitySchema.write(writerAt(out, abilitiesOffset + i * ITM_ABILITY_SIZE), abilities[i]!);
    }
    for (let i = 0; i < effects.length; i++) {
        effectSchema.write(writerAt(out, effectsOffset + i * EFFECT_SIZE), effects[i]!);
    }

    return out;
}

export function serializeItmCanonicalSnapshot(snapshot: ItmCanonicalSnapshot): Uint8Array {
    return serializeItmCanonicalDocument(snapshot.document);
}
