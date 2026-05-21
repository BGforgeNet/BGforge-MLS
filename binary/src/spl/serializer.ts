/**
 * SPL file serializer: converts a ParseResult back to binary SPL v1 bytes.
 * Built on the shared IE serializer factory; see ie-common/serializer.ts.
 */

import { createIeSerializer } from "../ie-common/serializer";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument, serializeSplCanonicalDocument } from "./canonical";

export const serializeSpl = createIeSerializer({
    getDocument: getSplCanonicalDocument,
    rebuildDocument: rebuildSplCanonicalDocument,
    serializeDocument: serializeSplCanonicalDocument,
});
