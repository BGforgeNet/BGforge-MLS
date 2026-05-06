/**
 * ITM file serializer: converts a ParseResult back to binary ITM v1 bytes.
 * The canonical document is the source of truth.
 */

import { getItmCanonicalDocument, rebuildItmCanonicalDocument, serializeItmCanonicalDocument } from "./canonical";
import type { ParseResult } from "../types";

export function serializeItm(result: ParseResult): Uint8Array {
    const document = getItmCanonicalDocument(result) ?? rebuildItmCanonicalDocument(result);
    return serializeItmCanonicalDocument(document);
}
