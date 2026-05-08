/**
 * EFF JSON-snapshot: thin wrapper around the IE json-snapshot factory
 * (`ie-common/json-snapshot.ts`).
 */

import {
    createEffCanonicalSnapshot,
    effCanonicalSnapshotSchemaPermissive,
    serializeEffCanonicalSnapshot,
    type EffCanonicalSnapshot,
} from "./canonical";
import { effParser } from "./index";
import { createIeJsonSnapshot } from "../ie-common/json-snapshot";

const layer = createIeJsonSnapshot<EffCanonicalSnapshot>({
    formatLabel: "EFF",
    snapshotSchemaPermissive: effCanonicalSnapshotSchemaPermissive,
    createSnapshot: createEffCanonicalSnapshot,
    serializeSnapshot: serializeEffCanonicalSnapshot,
    getParser: () => effParser,
});

export const createCanonicalEffJsonSnapshot = layer.createJson;
export const loadCanonicalEffJsonSnapshot = layer.loadJson;
