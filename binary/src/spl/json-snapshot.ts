/**
 * SPL JSON-snapshot: thin wrapper around the IE json-snapshot factory
 * (`ie-common/json-snapshot.ts`).
 */

import {
    createSplCanonicalSnapshot,
    splCanonicalSnapshotSchemaPermissive,
    serializeSplCanonicalSnapshot,
    type SplCanonicalSnapshot,
} from "./canonical";
import { splParser } from "./index";
import { createIeJsonSnapshot } from "../ie-common/json-snapshot";

const layer = createIeJsonSnapshot<SplCanonicalSnapshot>({
    formatLabel: "SPL",
    snapshotSchemaPermissive: splCanonicalSnapshotSchemaPermissive,
    createSnapshot: createSplCanonicalSnapshot,
    serializeSnapshot: serializeSplCanonicalSnapshot,
    getParser: () => splParser,
});

export const createCanonicalSplJsonSnapshot = layer.createJson;
export const loadCanonicalSplJsonSnapshot = layer.loadJson;
