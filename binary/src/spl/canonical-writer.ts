/**
 * Writer helpers for serialising SplCanonicalDocument back to SPL v1 bytes.
 *
 * Recomputes derived header fields (`extendedHeadersOffset/Count`,
 * `featureBlocksOffset`) from the doc shape via `enforceDerivedFields`.
 * Casting feature-block subset metadata is preserved as the user supplied
 * it (no derivation source). See `itm/canonical-writer.ts` for the parallel
 * shape and rationale.
 */

import { BufferWriter } from "typed-binary";
import { EFFECT_SIZE } from "../ie-common/types";
import { effectSchema, splAbilitySchema, splHeaderSchema } from "./schemas";
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE } from "./types";
import { type SplCanonicalDocument, type SplCanonicalSnapshot } from "./canonical-schemas";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";
import { enforceDerivedFields } from "../spec/types";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeSplCanonicalDocument(document: SplCanonicalDocument): Uint8Array {
    const { abilities, effects } = document;
    const abilitiesOffset = SPL_HEADER_SIZE;
    const effectsOffset = abilitiesOffset + abilities.length * SPL_ABILITY_SIZE;
    const header = enforceDerivedFields(splHeaderSpecAnnotated, document.header, {
        arrays: { abilities },
        sectionOffsets: { abilities: abilitiesOffset, effects: effectsOffset },
    });

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
