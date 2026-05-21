/**
 * Shared factory for IE format binary serializers.
 *
 * Every IE format (ITM, SPL, EFF, CRE) serializes the same way:
 *   1. Pull the canonical document off the ParseResult if present
 *      (it's the source of truth and was already validated on parse).
 *   2. Otherwise rebuild it from the parsed-field tree (post-edit case).
 *   3. Encode the canonical document back to bytes.
 *
 * The pattern is identical at the line level; this factory absorbs it so each
 * format adapter only has to bind its three codec functions instead of
 * re-stating the get-or-rebuild discipline four times.
 */

import type { ParseResult } from "../types";

interface IeSerializerCodec<TDocument> {
    getDocument: (result: ParseResult) => TDocument | undefined;
    rebuildDocument: (result: ParseResult) => TDocument;
    serializeDocument: (document: TDocument) => Uint8Array;
}

export function createIeSerializer<TDocument>(
    codec: IeSerializerCodec<TDocument>,
): (result: ParseResult) => Uint8Array {
    const { getDocument, rebuildDocument, serializeDocument } = codec;
    return (result: ParseResult): Uint8Array => {
        const document = getDocument(result) ?? rebuildDocument(result);
        return serializeDocument(document);
    };
}
