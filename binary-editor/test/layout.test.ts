import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, type ParseResult } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { buildLayout } from "../src/layout";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

/** Minimal ParseResult carrying a single empty depth-0 group (no children). Used to prove
 *  F1: the layout must report canModify and list-kind for an empty variable section where
 *  the old entry-probe approach could not find a representative child. */
function emptyGroupParseResult(groupName: string): ParseResult {
    return {
        format: "map",
        formatName: "MAP",
        root: { name: "Root", fields: [{ name: groupName, fields: [] }] },
    };
}

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

describe("buildLayout F1: empty list section", () => {
    it("reports canModify and list-kind for an empty Local Variables section (no children to probe)", () => {
        // F1: the old entry-probe approach returned canModify === false when the section had
        // zero entries because there was no representative child name to pass to isRemovableEntry.
        // isModifiableArray is shape-based and must return true regardless of entry count.
        const m = buildModel(emptyGroupParseResult("Local Variables"));
        const layout = buildLayout("map", m);
        const lv = layout.sections.find((s) => s.title === "Local Variables")!;
        expect(lv).toBeDefined();
        expect(lv.kind).toBe("list");
        expect(lv.canModify).toBe(true);
    });
});
