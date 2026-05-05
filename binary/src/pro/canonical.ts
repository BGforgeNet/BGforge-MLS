/**
 * Barrel re-export for the PRO canonical data model.
 * Split into: pro-canonical-schemas.ts, pro-canonical-reader.ts, pro-canonical-writer.ts.
 * This file preserves the public surface for all existing importers.
 */

export {
    proCanonicalSnapshotSchema,
    proCanonicalSnapshotSchemaPermissive,
    proCanonicalDocumentSchema,
    proCanonicalDocumentSchemaPermissive,
    type ProCanonicalSnapshot,
    type ProCanonicalDocument,
} from "./canonical-schemas";
export { createProCanonicalSnapshot, rebuildProCanonicalDocument, getProCanonicalDocument } from "./canonical-reader";
export { serializeProCanonicalSnapshot, serializeProCanonicalDocument } from "./canonical-writer";
