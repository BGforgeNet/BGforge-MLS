import { describe, expect, it } from "vitest";
import type { Row } from "@bgforge/binary-editor";
import { filterRows } from "../../../src/binary-editor/webview/state/filter";

function makeRow(name: string, summary?: string): Row {
    return {
        id: name,
        namePath: [name],
        depth: 1,
        kind: "field",
        name,
        summary,
        valueType: "uint16",
        rawValue: 0,
        displayValue: "0",
        editable: false,
    };
}

const rows: Row[] = [
    makeRow("Effect 0", "Invisibility: State"),
    makeRow("Effect 1", "Fire Damage"),
    makeRow("Effect 2", "Invisibility: Target"),
    makeRow("Effect 3"),
];

describe("filterRows", () => {
    it("returns all rows for an empty query (same array reference)", () => {
        const result = filterRows(rows, "");
        expect(result).toBe(rows);
    });

    it("returns all rows for a whitespace-only query (same array reference)", () => {
        const result = filterRows(rows, "   ");
        expect(result).toBe(rows);
    });

    it("matches on summary substring", () => {
        const result = filterRows(rows, "invis");
        expect(result.map((r) => r.name)).toEqual(["Effect 0", "Effect 2"]);
    });

    it("matches on name substring", () => {
        const result = filterRows(rows, "Effect 3");
        expect(result.map((r) => r.name)).toEqual(["Effect 3"]);
    });

    it("is case-insensitive", () => {
        const result = filterRows(rows, "FIRE");
        expect(result.map((r) => r.name)).toEqual(["Effect 1"]);
    });

    it("returns an empty array when no rows match", () => {
        const result = filterRows(rows, "zzznomatch");
        expect(result).toEqual([]);
    });

    it("treats undefined summary as an empty string (no crash)", () => {
        // Effect 3 has no summary; its name still matches.
        const result = filterRows(rows, "3");
        expect(result.map((r) => r.name)).toEqual(["Effect 3"]);
    });

    it("preserves original order", () => {
        const result = filterRows(rows, "Invisibility");
        expect(result.map((r) => r.name)).toEqual(["Effect 0", "Effect 2"]);
    });
});
