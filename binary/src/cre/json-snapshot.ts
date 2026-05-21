/**
 * CRE JSON-snapshot: thin wrapper around the IE json-snapshot factory.
 */

import {
    createCreCanonicalSnapshot,
    creCanonicalSnapshotSchemaPermissive,
    serializeCreCanonicalSnapshot,
    type CreCanonicalSnapshot,
} from "./canonical";
import { creParser } from "./index";
import { createIeJsonSnapshot } from "../ie-common/json-snapshot";

const layer = createIeJsonSnapshot<CreCanonicalSnapshot>({
    formatLabel: "CRE",
    snapshotSchemaPermissive: creCanonicalSnapshotSchemaPermissive,
    createSnapshot: createCreCanonicalSnapshot,
    serializeSnapshot: serializeCreCanonicalSnapshot,
    getParser: () => creParser,
});

export const createCanonicalCreJsonSnapshot = layer.createJson;
export const loadCanonicalCreJsonSnapshot = layer.loadJson;
