/**
 * ITM JSON-snapshot: thin wrapper around the IE json-snapshot factory
 * (`ie-common/json-snapshot.ts`).
 */

import {
    createItmCanonicalSnapshot,
    itmCanonicalSnapshotSchemaPermissive,
    serializeItmCanonicalSnapshot,
    type ItmCanonicalSnapshot,
} from "./canonical";
import { itmParser } from "./index";
import { createIeJsonSnapshot } from "../ie-common/json-snapshot";

const layer = createIeJsonSnapshot<ItmCanonicalSnapshot>({
    formatLabel: "ITM",
    snapshotSchemaPermissive: itmCanonicalSnapshotSchemaPermissive,
    createSnapshot: createItmCanonicalSnapshot,
    serializeSnapshot: serializeItmCanonicalSnapshot,
    getParser: () => itmParser,
});

export const createCanonicalItmJsonSnapshot = layer.createJson;
export const loadCanonicalItmJsonSnapshot = layer.loadJson;
