import { describe, expect, it } from "vitest";
import type { ParseResult } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { projectRow } from "../src/window";

/** Minimal tree: one group with one uint8 field child. */
function simpleResult(): ParseResult {
    return {
        format: "test",
        formatName: "Test Format",
        root: {
            name: "Root",
            fields: [
                {
                    name: "Entry",
                    fields: [
                        {
                            name: "Value",
                            value: 10,
                            offset: 0,
                            size: 1,
                            type: "uint8",
                        },
                    ],
                },
            ],
        },
    };
}

describe("projectRow summary", () => {
    it("attaches summary to a group row when the composer returns a non-empty string", () => {
        const m = buildModel(simpleResult());
        const group = m.nodes.find((n) => n.kind === "group" && n.name === "Entry")!;
        const row = projectRow(m, group, undefined, () => "X");
        expect(row.summary).toBe("X");
    });

    it("does NOT attach summary to a field row even when a composer is passed", () => {
        const m = buildModel(simpleResult());
        const field = m.nodes.find((n) => n.kind === "field")!;
        const row = projectRow(m, field, undefined, () => "X");
        expect(row.summary).toBeUndefined();
    });

    it("leaves summary unset on a group row when no composer is passed (back-compat)", () => {
        const m = buildModel(simpleResult());
        const group = m.nodes.find((n) => n.kind === "group" && n.name === "Entry")!;
        const row = projectRow(m, group, undefined);
        expect(row.summary).toBeUndefined();
    });

    it("leaves summary unset when the composer returns undefined", () => {
        const m = buildModel(simpleResult());
        const group = m.nodes.find((n) => n.kind === "group" && n.name === "Entry")!;
        const row = projectRow(m, group, undefined, () => undefined);
        expect(row.summary).toBeUndefined();
    });

    it("leaves summary unset when the composer returns an empty string", () => {
        const m = buildModel(simpleResult());
        const group = m.nodes.find((n) => n.kind === "group" && n.name === "Entry")!;
        const row = projectRow(m, group, undefined, () => "");
        expect(row.summary).toBeUndefined();
    });
});
