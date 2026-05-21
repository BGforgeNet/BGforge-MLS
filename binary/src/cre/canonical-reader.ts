/**
 * CRE canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`).
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import {
    type CreCanonicalDocument,
    type CreCanonicalSnapshot,
    creCanonicalDocumentSchemaPermissive,
    creCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";

const reader = createIeCanonicalReader<CreCanonicalDocument, CreCanonicalSnapshot>({
    formatId: "cre",
    formatLabel: "CRE",
    documentSchemaPermissive: creCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: creCanonicalSnapshotSchemaPermissive,
});

export const getCreCanonicalDocument = reader.getDocument;
export const rebuildCreCanonicalDocument = reader.rebuildDocument;
export const createCreCanonicalSnapshot = reader.createSnapshot;
