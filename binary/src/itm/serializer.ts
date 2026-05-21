/**
 * ITM file serializer: converts a ParseResult back to binary ITM v1 bytes.
 * Built on the shared IE serializer factory; see ie-common/serializer.ts.
 */

import { createIeSerializer } from "../ie-common/serializer";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument, serializeItmCanonicalDocument } from "./canonical";

export const serializeItm = createIeSerializer({
    getDocument: getItmCanonicalDocument,
    rebuildDocument: rebuildItmCanonicalDocument,
    serializeDocument: serializeItmCanonicalDocument,
});
