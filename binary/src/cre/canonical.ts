/**
 * Barrel re-export for the CRE canonical data model.
 */

export {
    type CreCanonicalDocument,
    type CreCanonicalSnapshot,
    type CreEffectsDocument,
    creCanonicalDocumentSchema,
    creCanonicalSnapshotSchema,
    creCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
export { createCreCanonicalSnapshot, getCreCanonicalDocument, rebuildCreCanonicalDocument } from "./canonical-reader";
export { serializeCreCanonicalDocument, serializeCreCanonicalSnapshot } from "./canonical-writer";
