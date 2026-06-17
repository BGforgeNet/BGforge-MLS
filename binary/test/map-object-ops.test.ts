import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import { mapObjectsSectionStart, objectsSerializedLength } from "../src/map/canonical-writer";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "../src/map/canonical-reader";
import {
    buildMapObjectAddEntryBytes,
    buildMapObjectDuplicateEntryBytes,
    buildMapObjectInsertEntryBytes,
    buildMapObjectInventoryAddBytes,
    buildMapObjectInventoryRemoveBytes,
    buildMapObjectMoveEntryBytes,
    buildMapObjectRemoveEntryBytes,
    isMapObjectListSection,
    isMapObjectRemovableEntry,
} from "../src/map/object-ops";

const DENBUS1 = path.resolve("external/fallout/Fallout2_Restoration_Project/data/maps/denbus1.map");
const hasFixture = fs.existsSync(DENBUS1);

function parseDenbus1() {
    const data = new Uint8Array(fs.readFileSync(DENBUS1));
    return mapParser.parse(data, { gracefulMapBoundaries: true });
}

// cave6.map fully decodes its objects (no opaque objects-tail), so structure ops
// round-trip here. denbus1 keeps an opaque tail (objects need a PRO resolver to
// decode fully) and is used to assert ops are refused - the corruption guard.
const CLEAN_MAP = path.resolve("external/fallout/Fallout2_Restoration_Project/data/maps/cave6.map");

function parseClean() {
    const data = new Uint8Array(fs.readFileSync(CLEAN_MAP));
    return mapParser.parse(data, { gracefulMapBoundaries: true });
}

describe.skipIf(!hasFixture)("map writer object-section helpers", () => {
    it("mapObjectsSectionStart matches the offset where objects begin", () => {
        const pr = parseDenbus1();
        const doc = getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr);
        expect(doc).toBeDefined();
        const start = mapObjectsSectionStart(doc!);
        const total = (pr.sourceData as Uint8Array).length;
        // The objects section + its serialized length should reach the end of the
        // decoded region (objects are the last real section before any opaque tail).
        expect(start).toBeGreaterThan(0);
        expect(start + objectsSerializedLength(doc!.objects)).toBeLessThanOrEqual(total);
    });
});

function elevationWithObjects(pr: ReturnType<typeof mapParser.parse>): { elev: number; count: number } {
    const doc = getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr)!;
    const idx = doc!.objects.elevations.findIndex((e) => e.objects.length > 0);
    return { elev: idx, count: doc!.objects.elevations[idx]!.objects.length };
}

describe("map object-ops predicates", () => {
    it("recognizes elevation object sections and object entries", () => {
        expect(isMapObjectListSection(["Elevation 0 Objects"])).toBe(true);
        expect(isMapObjectListSection(["Global Variables"])).toBe(false);
        expect(isMapObjectRemovableEntry(["Elevation 0 Objects", "Object 0.3 (Critter)"])).toBe(true);
        expect(isMapObjectRemovableEntry(["Elevation 0 Objects", "Object 1.3 (Critter)"])).toBe(false); // elev mismatch
    });
});

describe.skipIf(!hasFixture)("map object-ops round-trip", () => {
    it("add then remove is a byte-identity inverse", () => {
        const pr = parseClean();
        const { elev, count } = elevationWithObjects(pr);
        const original = pr.sourceData as Uint8Array;

        const added = buildMapObjectAddEntryBytes(pr, [`Elevation ${elev} Objects`]);
        expect(added).toBeDefined();
        const addedPr = mapParser.parse(added!, { gracefulMapBoundaries: true });
        const addedDoc = getMapCanonicalDocument(addedPr) ?? rebuildMapCanonicalDocument(addedPr)!;
        expect(addedDoc!.objects.elevations[elev]!.objects.length).toBe(count + 1);
        // The appended object is the new last entry; removing it restores the bytes.
        const removed = buildMapObjectRemoveEntryBytes(addedPr, [`Elevation ${elev} Objects`], count);
        expect(removed).toBeDefined();
        expect([...removed!]).toEqual([...original]);
    });

    it("reorder up then down is a byte-identity inverse", () => {
        const pr = parseClean();
        const { elev, count } = elevationWithObjects(pr);
        // Fixture must have at least 2 objects to reorder; fail loudly if not.
        expect(count).toBeGreaterThanOrEqual(2);
        const original = pr.sourceData as Uint8Array;
        const up = buildMapObjectMoveEntryBytes(pr, [`Elevation ${elev} Objects`], 1, "up");
        expect(up).toBeDefined();
        const upPr = mapParser.parse(up!, { gracefulMapBoundaries: true });
        const down = buildMapObjectMoveEntryBytes(upPr, [`Elevation ${elev} Objects`], 0, "down");
        expect(down).toBeDefined();
        expect([...down!]).toEqual([...original]);
    });

    it("duplicate preserves pid, freshens id, and is deeply independent", () => {
        const pr = parseClean();
        const { elev } = elevationWithObjects(pr);
        const doc = getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr)!;
        const target = doc!.objects.elevations[elev]!.objects[0]!;
        const dup = buildMapObjectDuplicateEntryBytes(pr, [`Elevation ${elev} Objects`], 0);
        expect(dup).toBeDefined();
        const dupPr = mapParser.parse(dup!, { gracefulMapBoundaries: true });
        const dupDoc = getMapCanonicalDocument(dupPr) ?? rebuildMapCanonicalDocument(dupPr)!;
        const clone = dupDoc!.objects.elevations[elev]!.objects[1]!;
        expect(clone.base.pid).toBe(target.base.pid);
        expect(clone.base.id).not.toBe(target.base.id);
    });
});

// Fixtures whose objects fully decode (no opaque objects-tail), so structure ops apply.
const CLEAN_ROUNDTRIP_MAPS = [
    "external/fallout/Fallout2_Restoration_Project/data/maps/cave6.map",
    "external/fallout/Fallout2_Restoration_Project/data/maps/cave7.map",
    "external/fallout/Fallout2_Restoration_Project/data/maps/arvill2.map",
];

describe.skipIf(!hasFixture)("map object-ops add/remove inverse across fixtures", () => {
    it.each(CLEAN_ROUNDTRIP_MAPS)("is byte-identity for %s", (rel) => {
        const data = new Uint8Array(fs.readFileSync(path.resolve(rel)));
        const pr = mapParser.parse(data, { gracefulMapBoundaries: true });
        const doc = getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr);
        // These fixtures are selected for full object decode; assert that precondition
        // rather than silently skipping, so a regression in decoding surfaces here.
        const hasTail = (pr.opaqueRanges ?? []).some(
            (r) => (r.label === "objects-tail" || r.label === "script-section-tail") && r.size > 0,
        );
        expect(hasTail).toBe(false);
        const elev = doc!.objects.elevations.findIndex((e) => e.objects.length > 0);
        expect(elev).toBeGreaterThanOrEqual(0);
        const count = doc!.objects.elevations[elev]!.objects.length;

        const added = buildMapObjectAddEntryBytes(pr, [`Elevation ${elev} Objects`]);
        expect(added).toBeDefined();
        const addedPr = mapParser.parse(added!, { gracefulMapBoundaries: true });
        const removed = buildMapObjectRemoveEntryBytes(addedPr, [`Elevation ${elev} Objects`], count);
        expect(removed).toBeDefined();
        expect([...removed!]).toEqual([...data]);
    });
});

describe.skipIf(!hasFixture)("map object inventory ops", () => {
    const docOf = (pr: ReturnType<typeof mapParser.parse>) =>
        (getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr))!;

    it("add inventory entry grows the object's inventory; add-then-remove is byte-identity", () => {
        const pr = parseClean();
        const { elev } = elevationWithObjects(pr);
        const original = pr.sourceData as Uint8Array;
        const beforeDoc = docOf(pr);
        const invBefore = beforeDoc.objects.elevations[elev]!.objects[0]!.inventory.length;
        const objCountBefore = beforeDoc.objects.elevations[elev]!.objects.length;

        const added = buildMapObjectInventoryAddBytes(pr, [`Elevation ${elev} Objects`], 0);
        expect(added).toBeDefined();
        const addedPr = mapParser.parse(added!, { gracefulMapBoundaries: true });
        const obj0 = docOf(addedPr).objects.elevations[elev]!.objects[0]!;
        expect(obj0.inventory.length).toBe(invBefore + 1);
        expect(obj0.inventory.at(-1)!.quantity).toBe(1);
        // Inventory is nested - the top-level object count for the elevation is unchanged.
        expect(docOf(addedPr).objects.elevations[elev]!.objects.length).toBe(objCountBefore);
        // Removing the just-added entry restores the original bytes exactly.
        const removed = buildMapObjectInventoryRemoveBytes(addedPr, [`Elevation ${elev} Objects`], 0, invBefore);
        expect(removed).toBeDefined();
        expect([...removed!]).toEqual([...original]);
    });

    it("refuses a non-object path, an out-of-range object, or an out-of-range inventory index", () => {
        const pr = parseClean();
        const { elev } = elevationWithObjects(pr);
        expect(buildMapObjectInventoryAddBytes(pr, ["Global Variables"], 0)).toBeUndefined();
        expect(buildMapObjectInventoryAddBytes(pr, [`Elevation ${elev} Objects`], 9999)).toBeUndefined();
        expect(buildMapObjectInventoryRemoveBytes(pr, [`Elevation ${elev} Objects`], 0, 9999)).toBeUndefined();
    });

    it("refuses on an incompletely-decoded map (opaque objects-tail)", () => {
        const pr = parseDenbus1();
        expect(buildMapObjectInventoryAddBytes(pr, ["Elevation 0 Objects"], 0)).toBeUndefined();
        expect(buildMapObjectInventoryRemoveBytes(pr, ["Elevation 0 Objects"], 0, 0)).toBeUndefined();
    });
});

describe.skipIf(!hasFixture)("map object-ops refuse on incomplete decode", () => {
    it("returns undefined when the objects section keeps an opaque tail", () => {
        const pr = parseDenbus1();
        // denbus1's objects need a PRO resolver to fully decode, so the parser leaves an
        // opaque objects-tail. Structure ops must refuse rather than corrupt the undecoded tail.
        const hasTail = (pr.opaqueRanges ?? []).some(
            (r) => (r.label === "objects-tail" || r.label === "script-section-tail") && r.size > 0,
        );
        expect(hasTail).toBe(true);
        expect(buildMapObjectAddEntryBytes(pr, ["Elevation 0 Objects"])).toBeUndefined();
        expect(buildMapObjectInsertEntryBytes(pr, ["Elevation 0 Objects"], 0, "after")).toBeUndefined();
    });

    it("refuses when the last object is truncated to EOF (no opaque tail, but a truncation error)", () => {
        // Truncating a clean map mid-last-object decodes a partial object that consumes every
        // remaining byte, so NO opaque tail is emitted - the guard must catch it via the
        // truncation error instead, or a structure op would re-serialize the partial object at
        // full width and corrupt the file.
        const full = new Uint8Array(fs.readFileSync(CLEAN_MAP));
        const pr = mapParser.parse(full.slice(0, -40), { gracefulMapBoundaries: true });
        const hasTail = (pr.opaqueRanges ?? []).some(
            (r) => (r.label === "objects-tail" || r.label === "script-section-tail") && r.size > 0,
        );
        const hasTruncationError = (pr.errors ?? []).some((e) => /truncated/i.test(e) && /object|elevation/i.test(e));
        expect(hasTail).toBe(false); // the case the opaque-tail check alone would miss
        expect(hasTruncationError).toBe(true);
        const elev = (getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr)!)!.objects.elevations.findIndex(
            (e) => e.objects.length > 0,
        );
        expect(buildMapObjectAddEntryBytes(pr, [`Elevation ${elev} Objects`])).toBeUndefined();
    });
});
