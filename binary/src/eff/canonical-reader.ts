/**
 * EFF canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`).
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import {
    type EffCanonicalDocument,
    type EffCanonicalSnapshot,
    effCanonicalDocumentSchemaPermissive,
    effCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";

const reader = createIeCanonicalReader<EffCanonicalDocument, EffCanonicalSnapshot>({
    formatId: "eff",
    formatLabel: "EFF",
    documentSchemaPermissive: effCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: effCanonicalSnapshotSchemaPermissive,
});

export const getEffCanonicalDocument = reader.getDocument;
export const rebuildEffCanonicalDocument = reader.rebuildDocument;
export const createEffCanonicalSnapshot = reader.createSnapshot;
