/**
 * Barrel re-export for the ITM canonical data model.
 * Mirrors the PRO/MAP layout (canonical-schemas / canonical-reader / canonical-writer).
 */

export {
    type ItmCanonicalDocument,
    itmCanonicalDocumentSchema,
    type ItmCanonicalSnapshot,
    itmCanonicalSnapshotSchema,
    itmCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
export { createItmCanonicalSnapshot, getItmCanonicalDocument, rebuildItmCanonicalDocument } from "./canonical-reader";
export { serializeItmCanonicalDocument, serializeItmCanonicalSnapshot } from "./canonical-writer";
