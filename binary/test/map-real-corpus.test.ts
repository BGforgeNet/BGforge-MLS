/**
 * MAP parsing against the real Fallout 2 corpus (`external/fallout`, reproducible via `pnpm test:external`).
 *
 * These are the cases that need a full vanilla map rather than a committed fixture: strict parsing and
 * byte-identity round-trips over a spread of real maps, and the tile-group handling (skip / re-pack /
 * snapshot-preserve) that only real tile data exercises. Every block skips cleanly when the corpus is absent.
 *
 * Its own file because vitest parallelises across files - see `map-fixtures.ts`.
 */

import { describe, expect, it } from "vitest";
import { mapParser } from "../src/map";
import { createBinaryJsonSnapshot, parseBinaryJsonSnapshot } from "../src/json-snapshot";
import type { ParseResult } from "../src/types";
import { findFieldByName, hasExternalMaps, loadMap, REAL_MAPS } from "./map-fixtures";

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

    it.skipIf(!hasExternalMaps).each(REAL_MAPS)("round-trips %s byte-for-byte", (mapPath) => {
        const mapData = loadMap(mapPath);
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        expect(result.errors).toBeUndefined();
        const serialized = mapParser.serialize!(result);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

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

        const serialized = mapParser.serialize!(result);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it.skipIf(!hasExternalMaps)("preserves skipped tile bytes through JSON snapshots", () => {
        const mapData = loadMap(REAL_MAPS[0]);
        const result = mapParser.parse(mapData, { skipMapTiles: true, gracefulMapBoundaries: true });

        expect(result.opaqueRanges?.some((range) => range.label === "tiles")).toBe(true);

        const reparsedSnapshot = parseBinaryJsonSnapshot(createBinaryJsonSnapshot(result));
        const serialized = mapParser.serialize!(reparsedSnapshot);

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
        (result as ParseResult).document = undefined;

        const serialized = mapParser.serialize!(result);
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
