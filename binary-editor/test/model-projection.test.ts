import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { itmFixturePresent, openItmSession } from "./ie-fixture";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/artemple.map");

describe("buildModel projection", () => {
    it("is identity for a format without projectDisplayRoot (ITM)", () => {
        if (!itmFixturePresent()) return; // vendored sample; skip if the IE fixtures are absent
        const model = openItmSession().model;
        const depth0 = model.nodes.filter((n) => n.depth === 0);
        // No projectDisplayRoot for ITM -> the flat model mirrors root.fields exactly.
        expect(depth0.map((n) => n.name)).toEqual(model.parseResult.root.fields.map((f) => f.name));
        // Identity projection records [name] as the source path for a depth-0 node.
        expect(depth0[0]!.sourceSegments).toEqual([depth0[0]!.name]);
    });

    it("lifts MAP object sections to depth 0 and drops the Objects Section wrapper", () => {
        const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const model = buildModel(mapParser.parse(data, { gracefulMapBoundaries: true }));
        const depth0 = model.nodes.filter((n) => n.depth === 0).map((n) => n.name);
        expect(depth0).not.toContain("Objects Section");
        expect(depth0).toContain("Elevation 0 Objects");
        expect(depth0).toContain("Objects"); // read-only counts form

        const objectNode = model.nodes.find((n) => /^Object \d+\.\d+ /.test(n.name));
        expect(objectNode).toBeDefined();
        // Display path is the lifted elevation section; the raw structural path is preserved.
        expect(objectNode!.namePath[0]).toMatch(/^Elevation \d+ Objects$/);
        expect(objectNode!.sourceSegments[0]).toBe("Objects Section");
    });
});
