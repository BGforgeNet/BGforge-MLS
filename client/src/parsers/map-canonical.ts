/**
 * Barrel re-export for the MAP canonical data model.
 * Split into: map-canonical-schemas.ts, map-canonical-reader.ts, map-canonical-writer.ts.
 * This file preserves the public surface for all existing importers.
 */

export { type MapCanonicalDocument, mapCanonicalSnapshotSchema, type MapCanonicalSnapshot } from "./map-canonical-schemas";
export { rebuildMapCanonicalDocument, getMapCanonicalDocument, createMapCanonicalSnapshot } from "./map-canonical-reader";
export { serializeMapCanonicalDocument } from "./map-canonical-writer";
