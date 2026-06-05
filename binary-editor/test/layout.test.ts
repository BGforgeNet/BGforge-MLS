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

describe("buildLayout capabilities", () => {
    it("marks Global Variables addable, modifiable, and inline-rendered", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
        const layout = buildLayout("map", m);
        const gv = layout.sections.find((s) => s.title === "Global Variables")!;
        expect(gv.canAdd).toBe(true);
        expect(gv.canModify).toBe(true);
        expect(gv.render).toBe("inline");
    });

    it("marks the Header form section non-addable", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
        const layout = buildLayout("map", m);
        const header = layout.sections.find((s) => s.kind === "form")!;
        expect(header.canAdd).toBe(false);
        expect(header.canModify).toBe(false);
        expect(header.render).toBe("master-detail");
    });
});
