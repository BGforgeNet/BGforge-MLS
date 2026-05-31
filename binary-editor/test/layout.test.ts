import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { buildLayout } from "../src/layout";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

describe("buildLayout (map)", () => {
    it("produces one section per depth-0 group, marking Global Variables a list", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
        const layout = buildLayout("map", m);
        expect(layout.formatId).toBe("map");
        const gv = layout.sections.find((s) => s.title === "Global Variables");
        expect(gv).toBeDefined();
        if (!gv) return;
        expect(gv.kind).toBe("list");
    });
});
