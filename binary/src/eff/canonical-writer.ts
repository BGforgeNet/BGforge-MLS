/**
 * Writer helpers for serialising EffCanonicalDocument back to EFF v2 bytes.
 * Single fixed-size record: header (8) + body (264) = 272 bytes.
 */

import { BufferWriter } from "typed-binary";
import { effBodySchema, effHeaderSchema } from "./schemas";
import { EFF_BODY_SIZE, EFF_HEADER_SIZE, EFF_TOTAL_SIZE } from "./types";
import { type EffCanonicalDocument, type EffCanonicalSnapshot } from "./canonical-schemas";

function writerAt(out: Uint8Array, offset: number): BufferWriter {
    return new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset });
}

export function serializeEffCanonicalDocument(document: EffCanonicalDocument): Uint8Array {
    const out = new Uint8Array(EFF_TOTAL_SIZE);
    effHeaderSchema.write(writerAt(out, 0), document.header);
    effBodySchema.write(writerAt(out, EFF_HEADER_SIZE), document.body);
    if (out.byteLength !== EFF_HEADER_SIZE + EFF_BODY_SIZE) {
        throw new Error(`EFF size invariant broken: ${out.byteLength} != ${EFF_HEADER_SIZE + EFF_BODY_SIZE}`);
    }
    return out;
}

export function serializeEffCanonicalSnapshot(snapshot: EffCanonicalSnapshot): Uint8Array {
    return serializeEffCanonicalDocument(snapshot.document);
}
