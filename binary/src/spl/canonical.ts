/**
 * Barrel re-export for the SPL canonical data model.
 */

export {
    type SplCanonicalDocument,
    splCanonicalDocumentSchema,
    type SplCanonicalSnapshot,
    splCanonicalSnapshotSchema,
    splCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
export { createSplCanonicalSnapshot, getSplCanonicalDocument, rebuildSplCanonicalDocument } from "./canonical-reader";
export { serializeSplCanonicalDocument, serializeSplCanonicalSnapshot } from "./canonical-writer";
