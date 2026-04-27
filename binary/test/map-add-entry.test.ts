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

const MAP_FIXTURE = path.resolve("client/testFixture/maps/artemple.map");

function loadMap() {
    const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
    return { data, parseResult: mapParser.parse(data) };
}

describe("mapFormatAdapter.buildAddEntryBytes", () => {
    it("appends a zero int32 to Global Variables and increments numGlobalVars", () => {
        const { parseResult } = loadMap();
        const before = parseResult.document as
            | { header: { numGlobalVars: number }; globalVariables: number[] }
            | undefined;
        expect(before).toBeDefined();
        const originalCount = before!.globalVariables.length;
        const originalHeaderCount = before!.header.numGlobalVars;

        const nextBytes = mapFormatAdapter.buildAddEntryBytes?.(parseResult, ["Global Variables"]);
        expect(nextBytes).toBeInstanceOf(Uint8Array);

        const reparsed = mapParser.parse(nextBytes!);
        const after = reparsed.document as { header: { numGlobalVars: number }; globalVariables: number[] };
        expect(after.globalVariables.length).toBe(originalCount + 1);
        expect(after.globalVariables[after.globalVariables.length - 1]).toBe(0);
        expect(after.header.numGlobalVars).toBe(originalHeaderCount + 1);
    });
});
