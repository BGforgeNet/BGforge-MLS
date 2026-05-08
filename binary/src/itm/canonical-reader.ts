/**
 * ITM canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`). The factory body documents the shared
 * shape; this file only supplies ITM's schemas and format discriminants.
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import {
    type ItmCanonicalDocument,
    type ItmCanonicalSnapshot,
    itmCanonicalDocumentSchemaPermissive,
    itmCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";

const reader = createIeCanonicalReader<ItmCanonicalDocument, ItmCanonicalSnapshot>({
    formatId: "itm",
    formatLabel: "ITM",
    documentSchemaPermissive: itmCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: itmCanonicalSnapshotSchemaPermissive,
});

export const getItmCanonicalDocument = reader.getDocument;
export const rebuildItmCanonicalDocument = reader.rebuildDocument;
export const createItmCanonicalSnapshot = reader.createSnapshot;
