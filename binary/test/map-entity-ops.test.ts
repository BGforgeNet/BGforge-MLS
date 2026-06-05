/**
 * Unit tests for buildMapDuplicateEntryBytes: copies a MAP variable entry
 * and inserts the copy immediately after it.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import { buildMapDuplicateEntryBytes } from "../src/map/entity-ops";

const MAP_FIXTURE = path.resolve("client/testFixture/maps/arcaves.map");

type GlobalsDoc = { header: { numGlobalVars: number }; globalVariables: number[] };

describe("buildMapDuplicateEntryBytes", () => {
    it("inserts a copy of the targeted global var immediately after it", () => {
        const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const parseResult = mapParser.parse(data);
        const before = parseResult.document as GlobalsDoc;
        expect(before.globalVariables.length).toBeGreaterThanOrEqual(1);

        const originalCount = before.globalVariables.length;
        const firstValue = before.globalVariables[0]!;

        const bytes = buildMapDuplicateEntryBytes(parseResult, ["Global Variables", "Global Var 0"]);
        expect(bytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(bytes!);
        const after = reparsed.document as GlobalsDoc;
        // one more entry
        expect(after.globalVariables.length).toBe(originalCount + 1);
        expect(after.header.numGlobalVars).toBe(originalCount + 1);
        // index 0 and index 1 both hold the original value
        expect(after.globalVariables[0]).toBe(firstValue);
        expect(after.globalVariables[1]).toBe(firstValue);
        // the rest of the array is unchanged
        expect(after.globalVariables.slice(2)).toEqual(before.globalVariables.slice(1));
    });

    it("returns undefined for a non-removable path", () => {
        const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const parseResult = mapParser.parse(data);
        expect(buildMapDuplicateEntryBytes(parseResult, ["Header", "Version"])).toBeUndefined();
    });

    it("survives the skipMapTiles opaque-range shift (tiles remain byte-clean after duplicate)", () => {
        const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const parseResult = mapParser.parse(data, { skipMapTiles: true });
        const before = parseResult.document as GlobalsDoc;

        const bytes = buildMapDuplicateEntryBytes(parseResult, ["Global Variables", "Global Var 0"]);
        expect(bytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(bytes!, { skipMapTiles: true });
        expect(reparsed.errors).toBeUndefined();
        const after = reparsed.document as GlobalsDoc;
        expect(after.globalVariables.length).toBe(before.globalVariables.length + 1);
        expect(after.header.numGlobalVars).toBe(before.globalVariables.length + 1);
    });
});
