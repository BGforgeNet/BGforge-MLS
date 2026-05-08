/**
 * SPL canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`).
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import {
    type SplCanonicalDocument,
    type SplCanonicalSnapshot,
    splCanonicalDocumentSchemaPermissive,
    splCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";

const reader = createIeCanonicalReader<SplCanonicalDocument, SplCanonicalSnapshot>({
    formatId: "spl",
    formatLabel: "SPL",
    documentSchemaPermissive: splCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: splCanonicalSnapshotSchemaPermissive,
});

export const getSplCanonicalDocument = reader.getDocument;
export const rebuildSplCanonicalDocument = reader.rebuildDocument;
export const createSplCanonicalSnapshot = reader.createSnapshot;
