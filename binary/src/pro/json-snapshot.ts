/**
 * PRO JSON-snapshot: a binding of the shared snapshot factory (`ie-common/json-snapshot.ts`), whose discipline
 * holds for any format whose bytes rebuild from the canonical document alone.
 *
 * Snapshot load is permissive: a snapshot dumped from a graceful-loaded file may carry out-of-enum /
 * out-of-domain values, and we want it to round-trip back to the editor for display. The strict gate fires
 * when the user explicitly serializes the canonical doc back to bytes for save (see canonical-writer's
 * serializeProCanonicalDocument).
 */

import {
    createProCanonicalSnapshot,
    proCanonicalSnapshotSchemaPermissive,
    serializeProCanonicalSnapshot,
    type ProCanonicalSnapshot,
} from "./canonical";
import { proParser } from "./index";
import { createIeJsonSnapshot } from "../ie-common/json-snapshot";

const layer = createIeJsonSnapshot<ProCanonicalSnapshot>({
    formatLabel: "PRO",
    snapshotSchemaPermissive: proCanonicalSnapshotSchemaPermissive,
    createSnapshot: createProCanonicalSnapshot,
    serializeSnapshot: serializeProCanonicalSnapshot,
    getParser: () => proParser,
});

/** The snapshot itself, unserialized - see `buildCanonicalMapJsonSnapshot` for why the split exists. */
export const buildCanonicalProJsonSnapshot = layer.buildJson;
export const createCanonicalProJsonSnapshot = layer.createJson;
export const loadCanonicalProJsonSnapshot = layer.loadJson;
