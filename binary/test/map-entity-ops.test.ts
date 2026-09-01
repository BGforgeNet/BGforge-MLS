/**
 * Unit tests for buildMapDuplicateEntryBytes: copies a MAP variable entry
 * and inserts the copy immediately after it.
 */

import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import { buildMapDuplicateEntryBytes } from "../src/map/entity-ops";
import { formatAdapterRegistry } from "../src/format-adapter";
import { REPO_ROOT } from "./repo-root";

const mapFormatAdapter = formatAdapterRegistry.get("map")!;

// arcaves.map carries 21 global vars; gives headroom for both add and remove tests.
const MAP_FIXTURE = path.join(REPO_ROOT, "client/testFixture/maps/arcaves.map");

// Parsed once for the file: the duplicate/add helpers read the parse result and emit fresh bytes, and each
// case reparses its own output. The afterAll below fails if a case mutates the shared result.
const FIXTURE_BYTES = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
const sharedParse = mapParser.parse(FIXTURE_BYTES);

function loadMap() {
    return { data: FIXTURE_BYTES, parseResult: sharedParse };
}

afterAll(() => {
    expect(Buffer.from(FIXTURE_BYTES).equals(Buffer.from(fs.readFileSync(MAP_FIXTURE)))).toBe(true);
    expect(sharedParse).toEqual(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
});

type GlobalsDoc = { header: { numGlobalVars: number }; globalVariables: number[] };
type LocalsDoc = { header: { numLocalVars: number }; localVariables: number[] };

describe("buildMapDuplicateEntryBytes", () => {
    it("inserts a copy of the targeted global var immediately after it", () => {
        const { parseResult } = loadMap();
        const before = parseResult.document as GlobalsDoc | undefined;
        expect(before).toBeDefined();
        expect(before!.globalVariables.length).toBeGreaterThanOrEqual(1);

        const originalCount = before!.globalVariables.length;
        const firstValue = before!.globalVariables[0]!;

        const bytes = buildMapDuplicateEntryBytes(parseResult, ["Global Variables"], 0);
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
        expect(after.globalVariables.slice(2)).toEqual(before!.globalVariables.slice(1));
    });

    it("inserts a copy of a mid-array global var immediately after it", () => {
        const { parseResult } = loadMap();
        const before = parseResult.document as GlobalsDoc | undefined;
        expect(before).toBeDefined();
        expect(before!.globalVariables.length).toBeGreaterThanOrEqual(4);

        const originalCount = before!.globalVariables.length;
        const targetIndex = 2;
        const targetValue = before!.globalVariables[targetIndex]!;

        const bytes = buildMapDuplicateEntryBytes(parseResult, ["Global Variables"], targetIndex);
        expect(bytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(bytes!);
        const after = reparsed.document as GlobalsDoc;
        // array grew by one
        expect(after.globalVariables.length).toBe(originalCount + 1);
        expect(after.header.numGlobalVars).toBe(originalCount + 1);
        // the copy lands immediately after the source
        expect(after.globalVariables[targetIndex]).toBe(targetValue);
        expect(after.globalVariables[targetIndex + 1]).toBe(targetValue);
        // entries before the target are unchanged
        expect(after.globalVariables.slice(0, targetIndex)).toEqual(before!.globalVariables.slice(0, targetIndex));
    });

    it("returns undefined for a non-removable path", () => {
        const { parseResult } = loadMap();
        expect(buildMapDuplicateEntryBytes(parseResult, ["Header"], 0)).toBeUndefined();
    });

    it("survives the skipMapTiles opaque-range shift (tiles remain byte-clean after duplicate)", () => {
        const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const parseResult = mapParser.parse(data, { skipMapTiles: true });
        const before = parseResult.document as GlobalsDoc | undefined;
        expect(before).toBeDefined();

        const bytes = buildMapDuplicateEntryBytes(parseResult, ["Global Variables"], 0);
        expect(bytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(bytes!, { skipMapTiles: true });
        expect(reparsed.errors).toBeUndefined();
        const after = reparsed.document as GlobalsDoc;
        expect(after.globalVariables.length).toBe(before!.globalVariables.length + 1);
        expect(after.header.numGlobalVars).toBe(before!.globalVariables.length + 1);
    });

    it("inserts a copy of a local var immediately after it", () => {
        // arcaves.map has 0 local vars; seed two via add to set up a duplicatable state.
        const { parseResult: base } = loadMap();
        const seededOnce = mapFormatAdapter.buildAddEntryBytes!(base, ["Local Variables"]);
        const seededTwice = mapFormatAdapter.buildAddEntryBytes!(mapParser.parse(seededOnce!), ["Local Variables"]);
        const seeded = mapParser.parse(seededTwice!);

        const before = seeded.document as LocalsDoc | undefined;
        expect(before).toBeDefined();
        expect(before!.localVariables.length).toBe(2);

        const originalCount = before!.localVariables.length;
        const targetValue = before!.localVariables[0]!;

        const bytes = buildMapDuplicateEntryBytes(seeded, ["Local Variables"], 0);
        expect(bytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(bytes!);
        const after = reparsed.document as LocalsDoc;
        expect(after.localVariables.length).toBe(originalCount + 1);
        expect(after.header.numLocalVars).toBe(originalCount + 1);
        // the copy equals the source
        expect(after.localVariables[0]).toBe(targetValue);
        expect(after.localVariables[1]).toBe(targetValue);
    });
});
