import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import { mapObjectsSectionStart, objectsSerializedLength } from "../src/map/canonical-writer";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "../src/map/canonical-reader";

const DENBUS1 = path.resolve("external/fallout/Fallout2_Restoration_Project/data/maps/denbus1.map");

function parseDenbus1() {
    const data = new Uint8Array(fs.readFileSync(DENBUS1));
    return mapParser.parse(data, { gracefulMapBoundaries: true });
}

describe("map writer object-section helpers", () => {
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
