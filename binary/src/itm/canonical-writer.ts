/**
 * Writer helpers for serialising ItmCanonicalDocument back to ITM v1 bytes.
 *
 * Honours whatever `extendedHeadersOffset` / `featureBlocksOffset` the
 * canonical doc declares. Real ITM files almost always have abilities
 * directly after the header and effects directly after the abilities, but
 * preserving the declared offsets keeps round-trip safe for files with
 * unusual layouts.
 */

import { BufferWriter } from "typed-binary";
import { itmAbilitySchema, effectSchema, itmHeaderSchema } from "./schemas";
import { EFFECT_SIZE } from "../ie-common/types";
import { ITM_ABILITY_SIZE, ITM_HEADER_SIZE } from "./types";
import { type ItmCanonicalDocument, type ItmCanonicalSnapshot } from "./canonical-schemas";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeItmCanonicalDocument(document: ItmCanonicalDocument): Uint8Array {
    const { header, abilities, effects } = document;
    const abilitiesOffset = header.extendedHeadersOffset;
    const effectsOffset = header.featureBlocksOffset;

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
