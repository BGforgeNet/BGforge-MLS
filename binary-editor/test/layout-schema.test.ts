import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLayoutSchema, proParser, toSemanticFieldKey, type FormatLayout } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { resolveLayout } from "../src/layout";
import { projectRow } from "../src/window";
import type { RelationshipModel } from "../src/relationship/types";

const PRO_FIXTURE = path.resolve(__dirname, "../../client/testFixture/proto/items/00000031.pro");

function proModel() {
    return buildModel(proParser.parse(new Uint8Array(fs.readFileSync(PRO_FIXTURE))));
}

/** A minimal valid single-variant layout referencing one real field key. */
function layoutFor(format: string, variantId: string, fieldKey: string): FormatLayout {
    return formatLayoutSchema.parse({
        schemaVersion: 1,
        format,
        variants: { [variantId]: { rows: [{ panels: [{ blocks: [{ kind: "fields", fields: [fieldKey] }] }] }] } },
    });
}

describe("formatLayoutSchema (zod validation)", () => {
    it("accepts a layout exercising every block kind", () => {
        expect(() =>
            formatLayoutSchema.parse({
                schemaVersion: 1,
                format: "pro",
                maxContentWidthPx: 900,
                variants: {
                    critter: {
                        rows: [
                            {
                                panels: [
                                    { title: "Header", blocks: [{ kind: "fields", fields: ["pro.x.a"] }] },
                                    { blocks: [{ kind: "flags", field: "pro.x.flags", columns: 2 }] },
                                ],
                            },
                            {
                                panels: [
                                    {
                                        title: "Stats",
                                        widthPx: 900,
                                        blocks: [
                                            {
                                                kind: "matrix",
                                                columnWidthPx: 190,
                                                valueColumns: [
                                                    { key: "base", label: "Base" },
                                                    { key: "bonus", label: "Bonus" },
                                                ],
                                                groups: [
                                                    {
                                                        label: "Primary",
                                                        rows: [
                                                            {
                                                                label: "Strength",
                                                                cells: { base: "pro.x.str", bonus: "pro.x.strBonus" },
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                            { panels: [{ blocks: [{ kind: "grid", columns: 4, items: ["pro.x.s1", "pro.x.s2"] }] }] },
                            {
                                panels: [
                                    { blocks: [{ kind: "list", sectionKey: "abilities", render: "master-detail" }] },
                                ],
                            },
                            { panels: [{ blocks: [{ kind: "raw" }] }] },
                        ],
                    },
                },
            }),
        ).not.toThrow();
    });

    it("rejects an unknown block kind", () => {
        expect(() =>
            formatLayoutSchema.parse({
                schemaVersion: 1,
                format: "pro",
                variants: { v: { rows: [{ panels: [{ blocks: [{ kind: "bogus" }] }] }] } },
            }),
        ).toThrow();
    });

    it("rejects a fields block with no fields", () => {
        expect(() =>
            formatLayoutSchema.parse({
                schemaVersion: 1,
                format: "pro",
                variants: { v: { rows: [{ panels: [{ blocks: [{ kind: "fields", fields: [] }] }] }] } },
            }),
        ).toThrow();
    });

    it("accepts a master-detail list block with a detailVariant of detail rows", () => {
        expect(() =>
            formatLayoutSchema.parse({
                schemaVersion: 1,
                format: "cre",
                variants: {
                    v: {
                        rows: [
                            {
                                panels: [
                                    {
                                        blocks: [
                                            {
                                                kind: "list",
                                                sectionKey: "Effects",
                                                render: "master-detail",
                                                detailVariant: [
                                                    {
                                                        panels: [
                                                            { blocks: [{ kind: "fields", fields: ["e.opcode"] }] },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            }),
        ).not.toThrow();
    });

    it("rejects a detailVariant that nests another list block (a detail pane holds no sub-lists)", () => {
        expect(() =>
            formatLayoutSchema.parse({
                schemaVersion: 1,
                format: "cre",
                variants: {
                    v: {
                        rows: [
                            {
                                panels: [
                                    {
                                        blocks: [
                                            {
                                                kind: "list",
                                                sectionKey: "Effects",
                                                render: "master-detail",
                                                detailVariant: [
                                                    {
                                                        panels: [
                                                            {
                                                                blocks: [
                                                                    {
                                                                        kind: "list",
                                                                        sectionKey: "Sub",
                                                                        render: "inline",
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            }),
        ).toThrow();
    });
});

describe("resolveLayout", () => {
    it("maps a referenced field's semantic key to its projected row", () => {
        const model = proModel();
        model.parseResult.variantId = "only"; // select the synthetic variant explicitly
        const fieldNode = model.nodes.find((n) => n.kind === "field");
        expect(fieldNode).toBeDefined();
        if (!fieldNode) return;
        const key = toSemanticFieldKey("pro", fieldNode.sourceSegments);
        expect(key).toBeDefined();
        if (key === undefined) return;

        const resolved = resolveLayout("pro", layoutFor("pro", "only", key), model);
        expect(resolved).toBeDefined();
        if (!resolved) return;
        expect(resolved.variantId).toBe("only");
        expect(resolved.rows!.length).toBe(1);
        // The referenced field resolves to the exact node's row.
        expect(resolved.fields[key]).toBeDefined();
        expect(resolved.fields[key]!.id).toBe(fieldNode.id);
        expect(resolved.fields[key]!.kind).toBe("field");
    });

    it("applies the relationship-model field overlay to projected layout rows", () => {
        // Regression: layout/form fields (e.g. the CRE Item Slots grid) are rendered from this `fields` map,
        // so resolveLayout must thread the relationship model into projectRow - otherwise a fieldOverride that
        // re-types a field to an enum dropdown is silently dropped for everything outside list blocks.
        const model = proModel();
        model.parseResult.variantId = "only";
        // A plain numeric field (not one the parser already renders as an enum), so the enum can only come
        // from the relationship overlay below.
        const fieldNode = model.nodes.find((n) => n.kind === "field" && projectRow(model, n).valueType !== "enum")!;
        const key = toSemanticFieldKey("pro", fieldNode.sourceSegments)!;
        const rel: RelationshipModel = {
            formatId: "pro",
            fieldOverride: (_m, node) =>
                node.id === fieldNode.id ? { presentationType: "enum", enumOptions: { "0": "Zero" } } : undefined,
            dependents: () => [],
            constraints: () => [],
        };
        const resolved = resolveLayout("pro", layoutFor("pro", "only", key), model, rel)!;
        expect(resolved.fields[key]!.valueType).toBe("enum");
        expect(resolved.fields[key]!.enumOptions).toEqual({ "0": "Zero" });
    });

    it("resolves the full field set, not only the referenced keys", () => {
        const model = proModel();
        model.parseResult.variantId = "only";
        const fieldNodeCount = model.nodes.filter((n) => n.kind === "field").length;
        const someKey = toSemanticFieldKey("pro", model.nodes.find((n) => n.kind === "field")!.sourceSegments)!;
        const resolved = resolveLayout("pro", layoutFor("pro", "only", someKey), model)!;
        // Every field node contributes a row (keys are unique per field), so the map covers them all.
        expect(Object.keys(resolved.fields).length).toBe(fieldNodeCount);
    });

    it("returns undefined when the parse result reports no variantId (falls back to tabs)", () => {
        const model = proModel();
        model.parseResult.variantId = undefined;
        expect(resolveLayout("pro", layoutFor("pro", "only", "pro.x.a"), model)).toBeUndefined();
    });

    it("selects the variant the parse result reports", () => {
        const model = proModel();
        model.parseResult.variantId = "second";
        const layout = formatLayoutSchema.parse({
            schemaVersion: 1,
            format: "pro",
            variants: {
                first: { rows: [{ panels: [{ blocks: [{ kind: "fields", fields: ["pro.x.a"] }] }] }] },
                second: { rows: [{ panels: [{ blocks: [{ kind: "raw" }] }, { blocks: [{ kind: "raw" }] }] }] },
            },
        });
        const resolved = resolveLayout("pro", layout, model)!;
        expect(resolved.variantId).toBe("second");
        expect(resolved.rows![0]!.panels.length).toBe(2);
    });

    it("returns undefined when the reported variant is absent (caller falls back to tabs)", () => {
        const model = proModel();
        model.parseResult.variantId = "does-not-exist";
        const layout = layoutFor("pro", "only", "pro.x.a");
        expect(resolveLayout("pro", layout, model)).toBeUndefined();
    });
});
