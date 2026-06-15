import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel, visibleNodes, setExpanded } from "../src/model";

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

describe("visibility", () => {
    it("shows only depth-0 nodes when nothing is expanded", () => {
        const m = model();
        const vis = visibleNodes(m);
        expect(vis.every((n) => n.depth === 0)).toBe(true);
    });

    it("reveals a group's children after expanding it", () => {
        const m = model();
        const gv = m.nodes.find((n) => n.depth === 0 && n.name === "Global Variables");
        expect(gv).toBeDefined();
        if (!gv) return; // narrow for TS
        setExpanded(m, gv.id, true);
        const vis = visibleNodes(m);
        const children = vis.filter((n) => n.parentId === gv.id);
        expect(children.length).toBe(gv.childCount);
    });
});
