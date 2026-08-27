/**
 * MAP JSON-snapshot round-trips: parse -> createBinaryJsonSnapshot -> parseBinaryJsonSnapshot -> serialize
 * must return the original bytes, across all four parse modes ({strict, graceful} x {full tiles, editor}).
 *
 * The four modes are distinct code paths and all four are covered; the fixture list they run against is
 * scoped to the structural axes that matter here - see `SNAPSHOT_STRICT_MAPS` in `map-fixtures.ts` for which
 * maps and why, and for what still covers the rest.
 *
 * Its own file because vitest parallelises across files: these blocks were the slowest part of
 * `map-parser.test.ts`, which was the binary suite's wall-clock floor.
 */

import { describe, expect, it } from "vitest";
import { mapParser } from "../src/map";
import { createBinaryJsonSnapshot, parseBinaryJsonSnapshot } from "../src/json-snapshot";
import { loadMap, resolveMapPath, SNAPSHOT_GRACEFUL_MAPS, SNAPSHOT_STRICT_MAPS } from "./map-fixtures";

/** parse with `options`, round-trip through a JSON snapshot, and assert the bytes come back unchanged. */
function assertSnapshotRoundTrip(fileName: string, options?: Parameters<typeof mapParser.parse>[1]): void {
    const mapData = loadMap(resolveMapPath(fileName));
    const result = mapParser.parse(mapData, options);

    expect(result.errors).toBeUndefined();

    const snapshot = parseBinaryJsonSnapshot(createBinaryJsonSnapshot(result));
    const serialized = mapParser.serialize(snapshot);

    expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
}

describe("MAP parser - JSON snapshot round-trips", () => {
    it.each(SNAPSHOT_STRICT_MAPS)("strict JSON snapshots round-trip %s byte-for-byte", (fileName) => {
        assertSnapshotRoundTrip(fileName);
    });

    it.each(SNAPSHOT_STRICT_MAPS)("strict editor-mode JSON snapshots round-trip %s byte-for-byte", (fileName) => {
        assertSnapshotRoundTrip(fileName, { skipMapTiles: true });
    });

    it.each(SNAPSHOT_GRACEFUL_MAPS)("graceful JSON snapshots round-trip %s byte-for-byte", (fileName) => {
        assertSnapshotRoundTrip(fileName, { gracefulMapBoundaries: true });
    });

    it.each(SNAPSHOT_GRACEFUL_MAPS)("graceful editor-mode JSON snapshots round-trip %s byte-for-byte", (fileName) => {
        assertSnapshotRoundTrip(fileName, { gracefulMapBoundaries: true, skipMapTiles: true });
    });
});
