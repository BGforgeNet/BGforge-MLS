/**
 * MAP file serializer: converts a ParseResult back to binary bytes.
 * The canonical document is the source of truth when available; the tree is
 * rebuilt into canonical form only as a fallback for synthetic test inputs.
 */

import { getMapCanonicalDocument, rebuildMapCanonicalDocument, serializeMapCanonicalDocument } from "./canonical";
import type { ParseResult } from "../types";

export function serializeMap(result: ParseResult): Uint8Array {
    const document = getMapCanonicalDocument(result) ?? rebuildMapCanonicalDocument(result);
    return serializeMapCanonicalDocument(document, result.opaqueRanges);
}
