/**
 * SPL file serializer: converts a ParseResult back to binary SPL v1 bytes.
 */

import { getSplCanonicalDocument, rebuildSplCanonicalDocument, serializeSplCanonicalDocument } from "./canonical";
import type { ParseResult } from "../types";

export function serializeSpl(result: ParseResult): Uint8Array {
    const document = getSplCanonicalDocument(result) ?? rebuildSplCanonicalDocument(result);
    return serializeSplCanonicalDocument(document);
}
