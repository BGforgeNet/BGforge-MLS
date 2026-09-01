/**
 * MAP parsing against the real Fallout 2 corpus (`external/fallout`, reproducible via `pnpm test:external`).
 *
 * These are the cases that need a full vanilla map rather than a committed fixture: strict parsing and
 * byte-identity round-trips over a spread of real maps, and the tile-group handling (skip / re-pack /
 * snapshot-preserve) that only real tile data exercises. Every block skips cleanly when the corpus is absent.
 *
 * Its own file because vitest parallelises across files - see `map-fixtures.ts`.
 */

import * as path from "path";
import { describe, expect, it } from "vitest";
import { mapParser } from "../src/map";
import { createBinaryJsonSnapshot, parseBinaryJsonSnapshot } from "../src/json-snapshot";
import {
    findFieldByName,
    hasExternalMaps,
    listCorpusMaps,
    loadMap,
    MAP_CORPUS_FLOOR,
    REAL_MAPS,
    roundTripMaps,
} from "./map-fixtures";

/**
 * How many real maps the byte-for-byte round-trip covers. Sized to span the corpus without making this
 * file - and so the binary suite - wall-clock bound: vitest parallelises across FILES, so every map added
 * here is serial time.
 */
const ROUNDTRIP_SAMPLE = 30;

/**
 * The sweep below is one serial loop over `ROUNDTRIP_SAMPLE` maps, so it is the longest single test in
 * this suite by a wide margin. Under the gate's coverage run, alongside the other package suites, it has
 * measured within a couple of percent of the suite's own 60s ceiling in both directions - passing one run
 * and timing out the next on no code change. Sized as a hang detector against the LOADED time rather than
 * the idle one, matching the corpus sweeps in image/test.
 */
const CORPUS_SWEEP_TIMEOUT_MS = 180_000;

/** Offset of the first differing byte, or the shorter length when one buffer is a prefix of the other. */
function firstDifference(a: Buffer, b: Buffer): number {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
        if (a[i] !== b[i]) return i;
    }
    return shared;
}

describe("MAP parser - real corpus", () => {
    it
        .skipIf(!hasExternalMaps)
        .each([REAL_MAPS[0], REAL_MAPS[1], REAL_MAPS[2], REAL_MAPS[3], REAL_MAPS[4], REAL_MAPS[5]])(
        "strictly parses %s without errors",
        (mapPath) => {
            const result = mapParser.parse(loadMap(mapPath));
            expect(result.errors).toBeUndefined();
            expect(result.root.fields.length).toBeGreaterThan(1);
        },
    );

    it.skipIf(!hasExternalMaps)(
        `round-trips ${ROUNDTRIP_SAMPLE} maps across the corpus byte-for-byte`,
        () => {
            // The corpus sweep in test-external.sh runs the binary CLI with --parse-only, so this is the only
            // place the canonical writer meets the real corpus. It asserts more than that sweep ever did: the
            // sweep only required parse -> canonical -> reserialize -> reparse to not throw, where this
            // requires the bytes back out to equal the bytes that went in.
            const population = listCorpusMaps();
            const sampled = roundTripMaps(ROUNDTRIP_SAMPLE);

            const failures: string[] = [];
            for (const mapPath of sampled) {
                const mapData = loadMap(mapPath);
                const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });
                const name = path.basename(mapPath);
                if (result.errors !== undefined) {
                    failures.push(`${name}: parse errors: ${result.errors.join("; ")}`);
                    continue;
                }
                const serialized = mapParser.serialize(result);
                const before = Buffer.from(mapData);
                const after = Buffer.from(serialized);
                if (!after.equals(before)) {
                    // Name where it diverged: "bytes differ" over a 400 KB map sends the reader back to a
                    // hex editor, and the offset usually identifies the section on its own.
                    const at = firstDifference(before, after);
                    failures.push(`${name}: ${before.length} bytes in, ${after.length} out, first differs at ${at}`);
                }
            }

            // The sample size leads, and names the population it came from, so a green here is never misread
            // as a statement about all of the corpus.
            const summary = `round-tripped ${sampled.length} of ${population.length} corpus maps`;
            expect(population.length, summary).toBeGreaterThanOrEqual(MAP_CORPUS_FLOOR);
            expect(sampled.length, summary).toBe(ROUNDTRIP_SAMPLE);
            expect(failures, summary).toEqual([]);
        },
        CORPUS_SWEEP_TIMEOUT_MS,
    );

    it.skipIf(!hasExternalMaps)("can skip loading tile groups for editor-oriented MAP parsing", () => {
        const mapData = loadMap(REAL_MAPS[0]);
        const result = mapParser.parse(mapData, { skipMapTiles: true, gracefulMapBoundaries: true });

        expect(result.errors).toBeUndefined();
        expect(
            result.root.fields.some(
                (field) =>
                    field &&
                    typeof field === "object" &&
                    "name" in field &&
                    /^Elevation \d+ Tiles$/.test(String(field.name)),
            ),
        ).toBe(false);

        const serialized = mapParser.serialize(result);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it.skipIf(!hasExternalMaps)("preserves skipped tile bytes through JSON snapshots", () => {
        const mapData = loadMap(REAL_MAPS[0]);
        const result = mapParser.parse(mapData, { skipMapTiles: true, gracefulMapBoundaries: true });

        expect(result.opaqueRanges?.some((range) => range.label === "tiles")).toBe(true);

        const reparsedSnapshot = parseBinaryJsonSnapshot(createBinaryJsonSnapshot(result));
        const serialized = mapParser.serialize(reparsedSnapshot);

        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it.skipIf(!hasExternalMaps)("re-packs tile ids and flags into the original 32-bit word", () => {
        const mapData = loadMap(REAL_MAPS[0]);
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });
        const tileGroup = result.root.fields.find((field) => "name" in field && field.name === "Elevation 0 Tiles");

        expect(tileGroup).toBeDefined();
        expect("fields" in tileGroup!).toBe(true);

        const tileFields = (tileGroup as { fields: unknown[] }).fields;
        const floorField = findFieldByName(tileFields, "Tile 0 Floor");
        const floorFlagsField = findFieldByName(tileFields, "Tile 0 Floor Flags");
        const roofField = findFieldByName(tileFields, "Tile 0 Roof");
        const roofFlagsField = findFieldByName(tileFields, "Tile 0 Roof Flags");

        floorField.value = 0x234;
        floorFlagsField.value = 0x5;
        roofField.value = 0x678;
        roofFlagsField.value = 0x9;
        result.document = undefined;

        const serialized = mapParser.serialize(result);
        const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);

        expect(view.getUint32(240, false)).toBe(0x96785234);
    });

    it.skipIf(!hasExternalMaps)(
        "parses object section counts and leaves a TODO when subtype resolution is missing",
        () => {
            const mapData = loadMap(REAL_MAPS[2]);
            const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });
            const objectsSection = result.root.fields.find(
                (field) => "name" in field && field.name === "Objects Section",
            );

            expect(objectsSection).toBeDefined();
            expect("fields" in objectsSection!).toBe(true);

            const objectFields = (objectsSection as { fields: unknown[] }).fields;
            const totalObjects = findFieldByName(objectFields, "Total Objects");
            expect(totalObjects.value).toBe(4886);

            const elevation0 = objectFields.find(
                (field) =>
                    field && typeof field === "object" && "name" in field && field.name === "Elevation 0 Objects",
            ) as { fields: unknown[] } | undefined;
            expect(elevation0).toBeDefined();
            expect(findFieldByName(elevation0!.fields, "Object Count").value).toBe(4294);

            const todoNote = objectFields.find(
                (field) => field && typeof field === "object" && "name" in field && field.name === "Truncated",
            ) as { value: unknown } | undefined;
            expect(todoNote?.value).toContain("PRO");
        },
    );
});
