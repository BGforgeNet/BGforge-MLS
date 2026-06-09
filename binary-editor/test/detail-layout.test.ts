/**
 * The detail-layout helpers let a list entry's detail pane render through a SHARED layout fragment instead
 * of a generic auto-form: `buildDetailFieldMap` keys a selected entry's child rows by their semantic key (so
 * a fragment's `cre.effects[].v2.<field>` refs resolve against the per-entry subtree, sidestepping the
 * first-write-wins global `fields` map), and `detailVariantRefs` / `detailVariantResolves` decide whether the
 * fragment actually matches the entry (so a v1 effect under a v2 fragment falls back to the auto-form rather
 * than rendering a broken partial). See the binary-editor uniform-shared-layout principle.
 */

import { describe, expect, it } from "vitest";
import type { DetailRow, Row } from "../src";
import { buildDetailFieldMap, detailVariantRefs, detailVariantResolves } from "../src/detail-layout";

function fieldRow(id: string, semanticKey: string | undefined, name: string): Row {
    return { id, namePath: [name], depth: 2, kind: "field", name, ...(semanticKey !== undefined && { semanticKey }) };
}

describe("buildDetailFieldMap", () => {
    it("keys rows by their semantic key", () => {
        const rows = [fieldRow("0/0/0", "cre.effects[].v2.opcode", "Opcode")];
        const map = buildDetailFieldMap(rows);
        expect(map["cre.effects[].v2.opcode"]?.id).toBe("0/0/0");
    });

    it("applies a label override to the row name without changing its key", () => {
        const rows = [fieldRow("0/0/1", "cre.effects[].v2.casterXCoord", "Caster X Coord")];
        const map = buildDetailFieldMap(rows, { "cre.effects[].v2.casterXCoord": "Caster X Coordinate" });
        expect(map["cre.effects[].v2.casterXCoord"]?.name).toBe("Caster X Coordinate");
    });

    it("skips rows that carry no semantic key", () => {
        const rows = [fieldRow("0/0/2", undefined, "padding")];
        expect(Object.keys(buildDetailFieldMap(rows))).toHaveLength(0);
    });
});

describe("detailVariantRefs", () => {
    it("collects field refs across fields, group, flags, grid and matrix blocks", () => {
        const rows: DetailRow[] = [
            {
                panels: [
                    {
                        title: "A",
                        blocks: [
                            { kind: "fields", fields: ["p.a", "p.b"] },
                            { kind: "group", label: "G", fields: ["p.c"] },
                            { kind: "flags", field: "p.flags" },
                            { kind: "grid", columns: 2, items: ["p.g1", "p.g2"] },
                            {
                                kind: "matrix",
                                valueColumns: [{ key: "base", label: "Base" }],
                                groups: [{ label: "G", rows: [{ label: "r", cells: { base: "p.m1" } }] }],
                            },
                        ],
                    },
                ],
            },
        ];
        expect(new Set(detailVariantRefs(rows))).toEqual(
            new Set(["p.a", "p.b", "p.c", "p.flags", "p.g1", "p.g2", "p.m1"]),
        );
    });
});

describe("detailVariantResolves", () => {
    const rows: DetailRow[] = [{ panels: [{ blocks: [{ kind: "fields", fields: ["p.a", "p.b"] }] }] }];

    it("is true when every referenced ref is present in the map", () => {
        const map = { "p.a": fieldRow("0", "p.a", "A"), "p.b": fieldRow("1", "p.b", "B") };
        expect(detailVariantResolves(rows, map)).toBe(true);
    });

    it("is false when any referenced ref is missing (e.g. a v1 entry under a v2 fragment)", () => {
        const map = { "p.a": fieldRow("0", "p.a", "A") };
        expect(detailVariantResolves(rows, map)).toBe(false);
    });
});
