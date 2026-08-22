/**
 * MAP parser: interface, canonical-document behaviour, serializer invariants, ambiguous-boundary handling
 * and error cases - the cases that run against committed fixtures.
 *
 * Two sibling files carry the rest so vitest can run them in parallel (see `map-fixtures.ts`):
 * `map-json-snapshot.test.ts` (the JSON-snapshot x parse-mode matrix) and `map-real-corpus.test.ts`
 * (everything needing a real vanilla map from `external/fallout`).
 */

import { describe, expect, it } from "vitest";
import { mapParser } from "../src/map";
import { createBinaryJsonSnapshot } from "../src/json-snapshot";
import type { ParseResult } from "../src/types";
import { findFieldByName, findGroupByName, loadMap, resolveMapPath } from "./map-fixtures";

describe("MAP parser - interface", () => {
    it("has id 'map'", () => {
        expect(mapParser.id).toBe("map");
    });

    it("has name 'Fallout MAP'", () => {
        expect(mapParser.name).toBe("Fallout MAP");
    });

    it("handles .map extension", () => {
        expect(mapParser.extensions).toContain("map");
    });

    it("has serialize method", () => {
        expect(typeof mapParser.serialize).toBe("function");
    });
});

describe("MAP parser - real maps", () => {
    it("attaches a semantic canonical MAP document alongside the editor tree", () => {
        const result = mapParser.parse(loadMap(resolveMapPath("artemple.map")), {
            gracefulMapBoundaries: true,
        }) as ParseResult & {
            document?: {
                header?: {
                    version: number;
                    filename: string;
                    defaultPosition: number;
                };
                globalVariables?: number[];
                localVariables?: number[];
                scripts?: unknown[];
                objects?: {
                    totalObjects: number;
                };
            };
        };

        expect(result.document?.header).toMatchObject({
            version: 20,
        });
        expect(typeof result.document?.header?.filename).toBe("string");
        expect(typeof result.document?.header?.defaultPosition).toBe("number");
        expect(Array.isArray(result.document?.globalVariables)).toBe(true);
        expect(Array.isArray(result.document?.localVariables)).toBe(true);
        expect(Array.isArray(result.document?.scripts)).toBe(true);
        expect(typeof result.document?.objects?.totalObjects).toBe("number");
        expect(result.sourceData).toBeInstanceOf(Uint8Array);
        expect(
            result.sourceData &&
                Buffer.from(result.sourceData).equals(Buffer.from(loadMap(resolveMapPath("artemple.map")))),
        ).toBe(true);
    });

    it("strict mode preserves PRO-dependent object tails as opaque ranges without parse errors", () => {
        const mapData = loadMap(resolveMapPath("denbus1.map"));
        const result = mapParser.parse(mapData);

        expect(result.errors).toBeUndefined();
        expect(result.opaqueRanges?.some((range) => range.label === "objects-tail")).toBe(true);

        const serialized = mapParser.serialize!(result);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it("serializes from the canonical MAP document instead of the display tree when present", () => {
        const mapData = loadMap(resolveMapPath("artemple.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        const header = findGroupByName(result.root.fields, "Header");
        const version = findFieldByName(header.fields, "Version");
        version.value = 999;

        const serialized = mapParser.serialize!(result);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it("serializer recomputes per-object inventoryLength, ignoring corrupted input", async () => {
        const { serializeMapCanonicalDocument } = await import("../src/map/canonical-writer");
        const { getMapCanonicalDocument } = await import("../src/map/canonical-reader");
        // Pick a fixture with at least one object that has an inventory entry,
        // so the recompute has a non-trivial array length to verify against.
        const mapData = loadMap(resolveMapPath("denbus1.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });
        const doc = getMapCanonicalDocument(result);
        if (!doc) throw new Error("no canonical doc");
        // Find an object with at least one inventory entry. Walk the
        // elevations until one shows up.
        let mutated = false;
        const corrupted = {
            ...doc,
            objects: {
                ...doc.objects,
                elevations: doc.objects.elevations.map((elev) => ({
                    ...elev,
                    objects: elev.objects.map((obj) => {
                        if (!mutated && obj.inventory.length > 0) {
                            mutated = true;
                            return {
                                ...obj,
                                inventoryHeader: { ...obj.inventoryHeader, inventoryLength: 99999 },
                            };
                        }
                        return obj;
                    }),
                })),
            },
        };
        if (!mutated) throw new Error("no inventory-bearing object in fixture");
        const serialized = serializeMapCanonicalDocument(corrupted, result.opaqueRanges ?? []);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it("serializer recomputes derived header counts (numLocalVars / numGlobalVars), ignoring corrupted input", async () => {
        const { serializeMapCanonicalDocument } = await import("../src/map/canonical-writer");
        const { getMapCanonicalDocument } = await import("../src/map/canonical-reader");
        const mapData = loadMap(resolveMapPath("artemple.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });
        const doc = getMapCanonicalDocument(result);
        if (!doc) throw new Error("no canonical doc");
        const corrupted = {
            ...doc,
            header: {
                ...doc.header,
                // Wrong on-wire counts; the writer must overwrite them with
                // the actual array lengths so the file remains parseable.
                numLocalVars: 99999,
                numGlobalVars: 99999,
            },
        };
        const serialized = serializeMapCanonicalDocument(corrupted, result.opaqueRanges ?? []);
        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it("clamps invalid header values while rebuilding canonical data for save and JSON export", () => {
        const mapData = loadMap(resolveMapPath("artemple.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        const header = findGroupByName(result.root.fields, "Header");
        const defaultOrientation = findFieldByName(header.fields, "Default Orientation");
        defaultOrientation.value = "invalid";
        defaultOrientation.rawValue = 6;
        result.document = undefined;

        const snapshot = JSON.parse(createBinaryJsonSnapshot(result)) as {
            document: { header: { defaultOrientation: number } };
        };
        expect(snapshot.document.header.defaultOrientation).toBe(5);

        const serialized = mapParser.serialize!(result);
        const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);
        expect(view.getInt32(0x1c, false)).toBe(5);
    });

    it("parses arcaves.map object headers at the correct script boundary", () => {
        const mapData = loadMap(resolveMapPath("arcaves.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        expect(result.errors).toBeUndefined();

        const objectsSection = findGroupByName(result.root.fields, "Objects Section");
        const elevation0 = findGroupByName(objectsSection.fields, "Elevation 0 Objects");
        const firstObject = elevation0.fields.find(
            (field) => field && typeof field === "object" && "name" in field && field.name === "Object 0.0 (Misc)",
        ) as { fields: unknown[] } | undefined;

        expect(firstObject).toBeDefined();
        expect(findFieldByName(firstObject!.fields, "Rotation").rawValue).toBe(0);
        expect(findFieldByName(firstObject!.fields, "Elevation").rawValue).toBe(0);
        // PID is a packed dword shown in hex (0x0500000C == 83886092); rawValue keeps the decoded number.
        expect(findFieldByName(firstObject!.fields, "PID").value).toBe("0x0500000c");
        expect(findFieldByName(firstObject!.fields, "PID").rawValue).toBe(83886092);
        // SID is a packed dword shown in hex; the "no script" sentinel -1 renders as the unsigned 32-bit
        // pattern 0xffffffff (rawValue keeps the signed -1).
        expect(findFieldByName(firstObject!.fields, "SID").value).toBe("0xffffffff");
        expect(findFieldByName(firstObject!.fields, "SID").rawValue).toBe(-1);
        expect(findFieldByName(firstObject!.fields, "Field 74").value).toBe(0);
    });

    it("stops MAP filename decoding at the first NUL byte", () => {
        const mapData = loadMap(resolveMapPath("newr2.map"));
        const result = mapParser.parse(mapData);

        expect(result.errors).toBeUndefined();

        const header = findGroupByName(result.root.fields, "Header");
        expect(findFieldByName(header.fields, "Filename").value).toBe("NEWR2.MAP");
    });

    it("exposes MAP enums and flags with semantic field types", () => {
        const mapData = loadMap(resolveMapPath("arcaves.map"));
        const result = mapParser.parse(mapData);

        expect(result.errors).toBeUndefined();

        const header = findGroupByName(result.root.fields, "Header");
        expect(findFieldByName(header.fields, "Map Flags").type).toBe("flags");
        expect(findFieldByName(header.fields, "Default Elevation").type).toBe("enum");
        expect(findFieldByName(header.fields, "Default Orientation").type).toBe("enum");

        const firstScriptGroup = result.root.fields.find(
            (field) =>
                field &&
                typeof field === "object" &&
                "name" in field &&
                typeof field.name === "string" &&
                field.name.endsWith("Scripts") &&
                "fields" in field,
        ) as { fields: unknown[] } | undefined;
        expect(firstScriptGroup).toBeDefined();

        const extent0 = findGroupByName(firstScriptGroup!.fields, "Extent 0");
        const slot0 = findGroupByName(extent0.fields, "Slot 0");
        expect(findFieldByName(slot0.fields, "Entry 0 Flags").type).toBe("flags");
        expect(findFieldByName(slot0.fields, "Entry 0 Action").type).toBe("enum");
        expect(findFieldByName(slot0.fields, "Entry 0 Action Being Used").type).toBe("enum");

        const objectsSection = findGroupByName(result.root.fields, "Objects Section");
        const elevation0 = findGroupByName(objectsSection.fields, "Elevation 0 Objects");
        const firstObject = elevation0.fields.find(
            (field) => field && typeof field === "object" && "name" in field && field.name === "Object 0.0 (Misc)",
        ) as { fields: unknown[] } | undefined;

        expect(firstObject).toBeDefined();
        expect(findFieldByName(firstObject!.fields, "Flags").type).toBe("flags");
        expect(findFieldByName(firstObject!.fields, "Rotation").type).toBe("enum");
        expect(findFieldByName(firstObject!.fields, "Elevation").type).toBe("enum");

        const exitGridResult = mapParser.parse(loadMap(resolveMapPath("bhrnddst.map")));
        expect(exitGridResult.errors).toBeUndefined();

        const exitObjectsSection = findGroupByName(exitGridResult.root.fields, "Objects Section");
        const exitElevation0 = findGroupByName(exitObjectsSection.fields, "Elevation 0 Objects");
        const exitObject = exitElevation0.fields.find(
            (field) =>
                field &&
                typeof field === "object" &&
                "fields" in field &&
                (field as { fields: unknown[] }).fields.some(
                    (child) => child && typeof child === "object" && "name" in child && child.name === "Exit Grid",
                ),
        ) as { fields: unknown[] } | undefined;

        expect(exitObject).toBeDefined();
        const exitGrid = findGroupByName(exitObject!.fields, "Exit Grid");
        expect(findFieldByName(exitGrid.fields, "Destination Elevation").type).toBe("enum");
        expect(findFieldByName(exitGrid.fields, "Destination Rotation").type).toBe("enum");
    });

    it("parses sfsheng.map without script overflow errors", () => {
        const mapData = loadMap(resolveMapPath("sfsheng.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        expect(result.errors).toBeUndefined();
        expect(
            result.root.fields.some(
                (field) => field && typeof field === "object" && "name" in field && field.name === "Objects Section",
            ),
        ).toBe(true);
    });

    it.each(["sfsheng.map"])("falls back to an opaque object section for ambiguous %s boundaries", (fileName) => {
        const mapData = loadMap(resolveMapPath(fileName));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        expect(result.errors).toBeUndefined();

        const objectsSection = findGroupByName(result.root.fields, "Objects Section");
        expect(findFieldByName(objectsSection.fields, "Total Objects").value).toBe(0);

        const elevation0 = findGroupByName(objectsSection.fields, "Elevation 0 Objects");
        expect(findFieldByName(elevation0.fields, "Object Count").value).toBe(0);

        const todoNote = objectsSection.fields.find(
            (field) => field && typeof field === "object" && "name" in field && field.name === "Truncated",
        ) as { value: unknown } | undefined;
        expect(todoNote?.value).toContain("boundary");

        const firstObject = elevation0.fields.find(
            (field) =>
                field && typeof field === "object" && "name" in field && /^Object \d+\.\d+ /.test(String(field.name)),
        );
        expect(firstObject).toBeUndefined();
    });

    it("round-trips an ambiguous MAP through JSON using opaque byte ranges", () => {
        const mapData = loadMap(resolveMapPath("sfsheng.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });

        expect(result.errors).toBeUndefined();

        const jsonText = JSON.stringify(result, null, 2);
        const reparsed = JSON.parse(jsonText);
        const serialized = mapParser.serialize!(reparsed);

        expect(Buffer.from(serialized).equals(Buffer.from(mapData))).toBe(true);
    });

    it("emits diff-friendly chunked opaque byte ranges for ambiguous MAP tails", () => {
        const mapData = loadMap(resolveMapPath("sfsheng.map"));
        const result = mapParser.parse(mapData, { gracefulMapBoundaries: true });
        const jsonText = JSON.stringify(result, null, 2);
        const parsed = JSON.parse(jsonText) as {
            opaqueRanges?: Array<{ label: unknown; offset: unknown; size: unknown; hexChunks: unknown }>;
        };

        expect(parsed.opaqueRanges).toBeDefined();
        expect(parsed.opaqueRanges!.length).toBeGreaterThan(0);

        const opaqueRange = parsed.opaqueRanges!.find((range) => range.label === "objects-tail");
        expect(opaqueRange).toBeDefined();
        expect(typeof opaqueRange?.offset).toBe("number");
        expect(typeof opaqueRange?.size).toBe("number");
        expect(Array.isArray(opaqueRange?.hexChunks)).toBe(true);
        expect((opaqueRange!.hexChunks as unknown[]).length).toBeGreaterThan(0);
        expect(
            (opaqueRange!.hexChunks as unknown[]).every(
                (chunk) => typeof chunk === "string" && /^[0-9a-f]+$/.test(chunk) && chunk.length <= 64,
            ),
        ).toBe(true);
    });

    it.each(["sfsheng.map"])("fails strict parsing for deterministic %s script parse errors", (fileName) => {
        const mapData = loadMap(resolveMapPath(fileName));
        const result = mapParser.parse(mapData);

        expect(result.errors).toBeDefined();
        // The ambiguous boundary makes strict parsing misread the script-section
        // count; it is clamped to the remaining buffer and rejected up front as a
        // deterministic malformed-script error (rather than spinning extents into
        // a later per-slot overflow).
        expect(
            result.errors?.some(
                (error) => error.includes("scripts for type") && error.includes("treating as malformed"),
            ),
        ).toBe(true);
        expect(result.opaqueRanges?.some((range) => range.label === "objects-tail")).toBe(false);
    });
});

describe("MAP parser - error cases", () => {
    it("rejects empty files", () => {
        const result = mapParser.parse(new Uint8Array(0));
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("rejects files smaller than header", () => {
        const result = mapParser.parse(new Uint8Array(100));
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toContain("too small");
    });

    it("rejects malformed var counts without iterating into oversized loops", () => {
        // Build a buffer with a valid version field but a numGlobalVars value that
        // would otherwise drive a billion-iteration loop in parseVariables.
        const HEADER_SIZE = 0xf0;
        const buffer = new Uint8Array(HEADER_SIZE + 32);
        const view = new DataView(buffer.buffer);
        view.setInt32(0, 20, false); // valid version
        view.setInt32(48, 2147483647, false); // numGlobalVars: int32 max
        const start = Date.now();
        const result = mapParser.parse(buffer);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(1000);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.includes("global vars"))).toBe(true);
    });
});
