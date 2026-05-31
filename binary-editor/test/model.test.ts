import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

function model() {
    const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
    return buildModel(mapParser.parse(data));
}

describe("buildModel", () => {
    it("flattens the root into pre-order nodes with stable ids and name paths", () => {
        const m = model();
        // Root itself is not a node; its children are the depth-0 nodes.
        const depth0 = m.nodes.filter((n) => n.depth === 0);
        expect(depth0.length).toBeGreaterThan(0);
        const [first] = depth0;
        expect(first).toBeDefined();
        expect(first?.id).toBe("0");
        expect(first?.namePath.length).toBe(1);
    });

    it("assigns each node a unique id", () => {
        const m = model();
        const ids = new Set(m.nodes.map((n) => n.id));
        expect(ids.size).toBe(m.nodes.length);
    });

    it("includes a Global Variables group among the depth-0 nodes", () => {
        const m = model();
        const names = m.nodes.filter((n) => n.depth === 0).map((n) => n.name);
        expect(names).toContain("Global Variables");
    });
});
