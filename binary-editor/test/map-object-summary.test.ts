import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, buildFileDerivedParseOptions } from "@bgforge/binary";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";
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
    /** Summary of a synthetic object group named `name` under an elevation group, via the real composer. */
    function summaryForName(name: string): string | undefined {
        // Only the fields the composer reads are populated; a parsed MAP cannot carry an arbitrary group name.
        const model = {
            byId: new Map([
                ["elev", 0],
                ["obj", 1],
            ]),
            nodes: [
                { id: "elev", kind: "group", name: "Elevation 0 Objects" },
                { id: "obj", kind: "group", name, parentId: "elev" },
            ],
            childrenByParent: new Map(),
        } as unknown as ReturnType<typeof buildModel>;
        return summaryComposerFor("map")!(model.nodes[1]!, model, undefined);
    }

    it.each([
        ["Object 0.1 (Misc)", undefined],
        ["Object 0.1 (Misc)  \t", undefined],
        ["Object 0.1 (Item) (Weapon)", undefined],
        ["Object (a (b) (c)", undefined],
        ["Object ()", undefined],
        ["Object (x)y", undefined],
    ])("composes from the trailing parenthesized type of %j", (name) => {
        const expected = name.match(/\(([^)]+)\)\s*$/)?.[1];
        expect(summaryForName(name)).toBe(expected);
    });

    it("reads a long run of open parentheses in linear time", () => {
        const name = "(".repeat(100_000);
        let summary: string | undefined;
        const elapsed = cpuTimeMs(() => {
            summary = summaryForName(name);
        });
        expect(elapsed).toBeLessThan(500);
        expect(summary).toBeUndefined();
    });

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
