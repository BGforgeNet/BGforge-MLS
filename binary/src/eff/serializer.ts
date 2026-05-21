/**
 * EFF file serializer: converts a ParseResult back to binary EFF v2 bytes.
 * Built on the shared IE serializer factory; see ie-common/serializer.ts.
 */

import { createIeSerializer } from "../ie-common/serializer";
import { getEffCanonicalDocument, rebuildEffCanonicalDocument, serializeEffCanonicalDocument } from "./canonical";

export const serializeEff = createIeSerializer({
    getDocument: getEffCanonicalDocument,
    rebuildDocument: rebuildEffCanonicalDocument,
    serializeDocument: serializeEffCanonicalDocument,
});
