/**
 * CRE file serializer: converts a ParseResult back to binary CRE v1 bytes.
 * Built on the shared IE serializer factory; see ie-common/serializer.ts.
 */

import { createIeSerializer } from "../ie-common/serializer";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument, serializeCreCanonicalDocument } from "./canonical";

export const serializeCre = createIeSerializer({
    getDocument: getCreCanonicalDocument,
    rebuildDocument: rebuildCreCanonicalDocument,
    serializeDocument: serializeCreCanonicalDocument,
});
