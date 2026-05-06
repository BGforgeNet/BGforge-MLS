/**
 * Writer helpers for serialising SplCanonicalDocument back to SPL v1 bytes.
 * Honours canonical-declared offsets for round-trip safety with files that
 * have unusual layouts.
 */

import { BufferWriter } from "typed-binary";
import { EFFECT_SIZE } from "../ie-common/types";
import { effectSchema, splAbilitySchema, splHeaderSchema } from "./schemas";
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE } from "./types";
import { type SplCanonicalDocument, type SplCanonicalSnapshot } from "./canonical-schemas";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeSplCanonicalDocument(document: SplCanonicalDocument): Uint8Array {
    const { header, abilities, effects } = document;
    const abilitiesOffset = header.extendedHeadersOffset;
    const effectsOffset = header.featureBlocksOffset;

    const totalSize = Math.max(
        SPL_HEADER_SIZE,
        abilitiesOffset + abilities.length * SPL_ABILITY_SIZE,
        effectsOffset + effects.length * EFFECT_SIZE,
    );

    const out = new Uint8Array(totalSize);
    splHeaderSchema.write(writerAt(out, 0), header);

    for (let i = 0; i < abilities.length; i++) {
        splAbilitySchema.write(writerAt(out, abilitiesOffset + i * SPL_ABILITY_SIZE), abilities[i]!);
    }
    for (let i = 0; i < effects.length; i++) {
        effectSchema.write(writerAt(out, effectsOffset + i * EFFECT_SIZE), effects[i]!);
    }

    return out;
}

export function serializeSplCanonicalSnapshot(snapshot: SplCanonicalSnapshot): Uint8Array {
    return serializeSplCanonicalDocument(snapshot.document);
}
