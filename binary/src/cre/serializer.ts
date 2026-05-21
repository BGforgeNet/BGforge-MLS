/**
 * CRE file serializer: converts a ParseResult back to binary CRE v1 bytes.
 */

import { getCreCanonicalDocument, rebuildCreCanonicalDocument, serializeCreCanonicalDocument } from "./canonical";
import type { ParseResult } from "../types";

export function serializeCre(result: ParseResult): Uint8Array {
    const document = getCreCanonicalDocument(result) ?? rebuildCreCanonicalDocument(result);
    return serializeCreCanonicalDocument(document);
}
