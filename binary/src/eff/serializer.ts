/**
 * EFF file serializer: converts a ParseResult back to binary EFF v2 bytes.
 */

import { getEffCanonicalDocument, rebuildEffCanonicalDocument, serializeEffCanonicalDocument } from "./canonical";
import type { ParseResult } from "../types";

export function serializeEff(result: ParseResult): Uint8Array {
    const document = getEffCanonicalDocument(result) ?? rebuildEffCanonicalDocument(result);
    return serializeEffCanonicalDocument(document);
}
