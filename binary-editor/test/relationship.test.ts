import { describe, expect, it } from "vitest";
import { buildModel, type Model } from "../src/model";
import { projectRow } from "../src/window";
import type { RelationshipModel } from "../src/relationship/types";
import { ieEffectsModel } from "../src/relationship/ie-effects";
import type { ParseResult } from "@bgforge/binary";

function effectModel(opcode: number, p1: number, p2: number): Model {
    const result = {
        format: "eff",
        formatName: "EFF",
        root: {
            name: "EFF File",
            fields: [
                {
                    name: "Effect 1",
                    fields: [
                        {
                            name: "opcode",
                            value: opcode,
                            rawValue: opcode,
                            offset: 0,
                            size: 4,
                            type: "enum",
                            enumOptions: { [String(opcode)]: `op ${opcode}` },
                        },
                        { name: "parameter1", value: p1, offset: 8, size: 4, type: "uint32" },
                        { name: "parameter2", value: p2, offset: 12, size: 4, type: "uint32" },
                        { name: "probability1", value: 100, offset: 16, size: 1, type: "uint8" },
                        { name: "probability2", value: 0, offset: 17, size: 1, type: "uint8" },
                    ],
                },
            ],
        },
    } as unknown as ParseResult;
    return buildModel(result);
}

const labelModel: RelationshipModel = {
    formatId: "eff",
    fieldOverride: (_m, node) => (node.name === "parameter2" ? { label: "Type" } : undefined),
    dependents: () => [],
    constraints: () => [],
};

const enumModel: RelationshipModel = {
    formatId: "eff",
    fieldOverride: (_m, node) =>
        node.name === "parameter2" ? { presentationType: "enum", enumOptions: { "0": "A", "1": "B" } } : undefined,
    dependents: () => [],
    constraints: () => [],
};

describe("ieEffectsModel.fieldOverride", () => {
    it("relabels parameter1 from IESDP data for a known opcode", () => {
        const model = effectModel(1, 5, 2);
        const p1 = model.nodes.find((n) => n.name === "parameter1")!;
        expect(ieEffectsModel.fieldOverride(model, p1)?.label).toBe("Key Modifier");
    });
    it("re-types parameter2 to an enum dropdown when the opcode has a value table", () => {
        const model = effectModel(1, 5, 2);
        const p2 = model.nodes.find((n) => n.name === "parameter2")!;
        const ov = ieEffectsModel.fieldOverride(model, p2);
        expect(ov?.label).toBe("Type");
        expect(ov?.presentationType).toBe("enum");
        expect(ov?.enumOptions?.["0"]).toBe("Cumulative Modifier");
    });
    it("adds an engine-availability description to the opcode field", () => {
        const model = effectModel(1, 5, 2);
        const op = model.nodes.find((n) => n.name === "opcode")!;
        expect(ieEffectsModel.fieldOverride(model, op)?.description).toMatch(/BG1|BG2|engine/i);
    });
    it("produces no override for an unknown/modded opcode", () => {
        const model = effectModel(65000, 5, 2);
        const p1 = model.nodes.find((n) => n.name === "parameter1")!;
        expect(ieEffectsModel.fieldOverride(model, p1)).toBeUndefined();
    });
});

describe("projectRow overlay", () => {
    it("applies fieldOverride label to the row name", () => {
        const model = effectModel(1, 5, 2);
        const p2 = model.nodes.find((n) => n.name === "parameter2")!;
        expect(projectRow(model, p2, labelModel).name).toBe("Type");
    });
    it("is unchanged when no model is passed", () => {
        const model = effectModel(1, 5, 2);
        const p2 = model.nodes.find((n) => n.name === "parameter2")!;
        expect(projectRow(model, p2).name).toBe("parameter2");
    });
    it("re-types a numeric field to enum so the view renders a dropdown", () => {
        const model = effectModel(1, 5, 2);
        const p2 = model.nodes.find((n) => n.name === "parameter2")!;
        const row = projectRow(model, p2, enumModel);
        // controlKind() in the view keys the dropdown off valueType === "enum" plus enumOptions.
        expect(row.valueType).toBe("enum");
        expect(row.enumOptions).toEqual({ "0": "A", "1": "B" });
    });
});
