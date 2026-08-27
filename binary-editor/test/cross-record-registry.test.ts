import { describe, expect, it } from "vitest";
import { buildModel, creResult } from "./cross-record-fixture";
import { getRelationshipModel } from "../src/relationship/registry";

describe("registry composition wires cross-record checks per format", () => {
    it("cre model surfaces a meminfo overshoot through constraints()", () => {
        const model = getRelationshipModel("cre");
        expect(model).toBeDefined();
        const m = buildModel(creResult({ memSpells: 1, items: 0, slots: [], meminfos: [{ start: 0, count: 9 }] }));
        const diags = model!.constraints(m);
        expect(diags.some((d) => d.severity === "warning" && d.message.includes("Memorized Spells"))).toBe(true);
    });
    it("eff model has no cross-record constraint (standalone effect)", () => {
        const model = getRelationshipModel("eff");
        expect(model).toBeDefined();
        // A bare EFF model with no Abilities/Effects-list groups yields no cross-record diagnostics.
        const m = buildModel({
            format: "eff",
            formatName: "EFF",
            root: { name: "EFF File", fields: [] },
        });
        expect(model!.constraints(m)).toHaveLength(0);
    });
});
