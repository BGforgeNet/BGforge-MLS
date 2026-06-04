import { describe, expect, it } from "vitest";
import { buildModel, type Model } from "../src/model";
import { projectRow } from "../src/window";
import type { RelationshipModel } from "../src/relationship/types";
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
});
