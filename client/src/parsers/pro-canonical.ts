/**
 * Barrel re-export for the PRO canonical data model.
 * Split into: pro-canonical-schemas.ts, pro-canonical-reader.ts, pro-canonical-writer.ts.
 * This file preserves the public surface for all existing importers.
 */

export { proCanonicalSnapshotSchema, type ProCanonicalSnapshot, type ProCanonicalDocument } from "./pro-canonical-schemas";
export { createProCanonicalSnapshot, rebuildProCanonicalDocument, getProCanonicalDocument } from "./pro-canonical-reader";
export { serializeProCanonicalSnapshot, serializeProCanonicalDocument } from "./pro-canonical-writer";
