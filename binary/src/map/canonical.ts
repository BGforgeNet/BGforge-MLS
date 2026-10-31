/**
 * Barrel re-export for the MAP canonical data model.
 * Split into: canonical-schemas.ts, canonical-reader.ts, canonical-writer.ts.
 * This file preserves the public surface for all existing importers.
 */

export { type MapCanonicalDocument, mapCanonicalSnapshotSchema, type MapCanonicalSnapshot } from "./canonical-schemas";
export { rebuildMapCanonicalDocument, getMapCanonicalDocument, createMapCanonicalSnapshot } from "./canonical-reader";
export { serializeMapCanonicalDocument } from "./canonical-writer";
