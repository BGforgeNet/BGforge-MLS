import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, buildFileDerivedParseOptions } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { projectRow } from "../src/window";
import { summaryComposerFor } from "../src/summary";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/artemple.map");
const SUBTYPE_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/denbus1.map");

function objectEntries(model: ReturnType<typeof buildModel>) {
    return model.nodes.filter(
        (n) => /^Object \d+\.\d+ /.test(n.name) && /^Elevation \d+ Objects$/.test(n.namePath[0] ?? ""),
    );
}

describe("map object summary", () => {
    it("summarizes a lifted object entry by its PID and type", () => {
        const model = buildModel(
            mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE)), { gracefulMapBoundaries: true }),
        );
        const obj = objectEntries(model)[0];
        expect(obj).toBeDefined();

        const compose = summaryComposerFor("map");
        const summary = compose!(obj!, model, undefined) ?? "";
        // PID hex plus the type from the group's own name, e.g. "0x0500000c Misc".
        expect(summary).toMatch(/0x[0-9a-f]{8}/);
        const type = obj!.name.match(/\(([^)]+)\)\s*$/)?.[1];
        expect(type, "object name carries a (Type)").toBeDefined();
        expect(summary).toContain(type!);
    });

    it("appends the decoded subtype for item/scenery objects", () => {
        const model = buildModel(
            mapParser.parse(
                new Uint8Array(fs.readFileSync(SUBTYPE_FIXTURE)),
                buildFileDerivedParseOptions(SUBTYPE_FIXTURE),
            ),
        );
        const compose = summaryComposerFor("map")!;
        // Find an object entry that decoded a Subtype Data group (item/scenery), and read its Sub Type label.
        const entry = objectEntries(model).find((o) =>
            (model.childrenByParent.get(o.id) ?? []).some((i) => model.nodes[i]?.name === "Subtype Data"),
        );
        expect(entry, "denbus1 has item/scenery objects with subtype trailers").toBeDefined();
        const subtypeGroup = (model.childrenByParent.get(entry!.id) ?? [])
            .map((i) => model.nodes[i]!)
            .find((c) => c.name === "Subtype Data")!;
        const subTypeNode = (model.childrenByParent.get(subtypeGroup.id) ?? [])
            .map((i) => model.nodes[i]!)
            .find((c) => c.name === "Sub Type")!;
        const subType = projectRow(model, subTypeNode).displayValue as string;

        const summary = compose(entry!, model, undefined) ?? "";
        expect(summary).toMatch(/0x[0-9a-f]{8}/);
        expect(summary).toContain(` / ${subType}`);
    });
});
