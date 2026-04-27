/**
 * Unit tests for the MAP adapter's add-entry pathway: extending a
 * variable-length array (globals/locals) and producing bytes that round-trip
 * through the parser with the expected element count + linked header count.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import { formatAdapterRegistry } from "../src/format-adapter";

const mapFormatAdapter = formatAdapterRegistry.get("map")!;

// arcaves.map carries 21 global vars; gives headroom for both add and remove tests.
const MAP_FIXTURE = path.resolve("client/testFixture/maps/arcaves.map");

function loadMap() {
    const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
    return { data, parseResult: mapParser.parse(data) };
}

type GlobalsDoc = { header: { numGlobalVars: number }; globalVariables: number[] };
type LocalsDoc = { header: { numLocalVars: number }; localVariables: number[] };

describe("mapFormatAdapter.buildAddEntryBytes", () => {
    it("appends a zero int32 to Global Variables and increments numGlobalVars", () => {
        const { parseResult } = loadMap();
        const before = parseResult.document as GlobalsDoc | undefined;
        expect(before).toBeDefined();
        const originalCount = before!.globalVariables.length;
        const originalHeaderCount = before!.header.numGlobalVars;

        const nextBytes = mapFormatAdapter.buildAddEntryBytes?.(parseResult, ["Global Variables"]);
        expect(nextBytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(nextBytes!);
        const after = reparsed.document as GlobalsDoc;
        expect(after.globalVariables.length).toBe(originalCount + 1);
        expect(after.globalVariables[after.globalVariables.length - 1]).toBe(0);
        expect(after.header.numGlobalVars).toBe(originalHeaderCount + 1);
    });
});

describe("mapFormatAdapter.buildAddEntryBytes for Local Variables", () => {
    it("appends a zero int32 to Local Variables and increments numLocalVars", () => {
        const { parseResult } = loadMap();
        const before = parseResult.document as LocalsDoc | undefined;
        expect(before).toBeDefined();
        const originalCount = before!.localVariables.length;
        const originalHeaderCount = before!.header.numLocalVars;

        const nextBytes = mapFormatAdapter.buildAddEntryBytes?.(parseResult, ["Local Variables"]);
        expect(nextBytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(nextBytes!);
        const after = reparsed.document as LocalsDoc;
        expect(after.localVariables.length).toBe(originalCount + 1);
        expect(after.localVariables[after.localVariables.length - 1]).toBe(0);
        expect(after.header.numLocalVars).toBe(originalHeaderCount + 1);
    });
});

describe("mapFormatAdapter.buildRemoveEntryBytes", () => {
    it("removes the targeted Global Variables entry and decrements numGlobalVars", () => {
        const { parseResult } = loadMap();
        const before = parseResult.document as GlobalsDoc | undefined;
        expect(before).toBeDefined();
        expect(before!.globalVariables.length).toBeGreaterThanOrEqual(2);
        const originalCount = before!.globalVariables.length;
        const originalHeaderCount = before!.header.numGlobalVars;
        const expectedTail = before!.globalVariables.slice(1);

        const nextBytes = mapFormatAdapter.buildRemoveEntryBytes?.(parseResult, ["Global Variables", "Global Var 0"]);
        expect(nextBytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(nextBytes!);
        const after = reparsed.document as GlobalsDoc;
        expect(after.globalVariables.length).toBe(originalCount - 1);
        expect(after.globalVariables).toEqual(expectedTail);
        expect(after.header.numGlobalVars).toBe(originalHeaderCount - 1);
    });

    it("removes the targeted Local Variables entry and decrements numLocalVars", () => {
        const { parseResult } = loadMap();
        // arcaves.map has 0 local vars; seed via add to set up a removable state.
        const seededOnce = mapFormatAdapter.buildAddEntryBytes!(parseResult, ["Local Variables"]);
        const seededTwice = mapFormatAdapter.buildAddEntryBytes!(mapParser.parse(seededOnce!), ["Local Variables"]);
        const seeded = mapParser.parse(seededTwice!);
        const before = seeded.document as LocalsDoc;
        expect(before.localVariables.length).toBe(2);
        const originalHeaderCount = before.header.numLocalVars;

        const nextBytes = mapFormatAdapter.buildRemoveEntryBytes?.(seeded, ["Local Variables", "Local Var 0"]);
        expect(nextBytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(nextBytes!);
        const after = reparsed.document as LocalsDoc;
        expect(after.localVariables.length).toBe(1);
        expect(after.header.numLocalVars).toBe(originalHeaderCount - 1);
    });
});
