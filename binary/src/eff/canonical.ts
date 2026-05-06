/**
 * Barrel re-export for the EFF canonical data model.
 */

export {
    type EffCanonicalDocument,
    effCanonicalDocumentSchema,
    type EffCanonicalSnapshot,
    effCanonicalSnapshotSchema,
    effCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
export { createEffCanonicalSnapshot, getEffCanonicalDocument, rebuildEffCanonicalDocument } from "./canonical-reader";
export { serializeEffCanonicalDocument, serializeEffCanonicalSnapshot } from "./canonical-writer";
