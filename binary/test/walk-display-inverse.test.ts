import { describe, expect, it } from "vitest";
import { walkStruct, structFromDisplay } from "../src/spec/walk-display";
import { effectSpecAnnotated } from "../src/ie-common/specs/effect.overrides";
import { charsSpec } from "../src/spec/types";

describe("structFromDisplay", () => {
    it("inverts walkStruct for a flat struct with scalar + chars fields", () => {
        // Sample covers all field types in effectSpecAnnotated:
        //   - plain scalars (u8, u16, u32)
        //   - enum fields (opcode, target, timing) - known + unknown values
        //   - flags fields (resistance, saveType) - carry string[] in SpecData;
        //     empty arrays used so the round-trip is trivially stable (0 -> [] -> 0)
        //   - chars field (resource) - no trailing spaces so forward trim is a no-op
        const sample = {
            opcode: 12,
            target: 1,
            power: 5,
            parameter1: 100,
            parameter2: 200,
            timing: 0,
            resistance: [] as string[],
            duration: 300,
            probability1: 50,
            probability2: 100,
            resource: "ABCD",
            maxLevel: 10,
            minLevel: 1,
            saveType: [] as string[],
            saveBonus: 0,
            stackingIdEx: 0,
        };
        const group = walkStruct(effectSpecAnnotated, {}, 0, sample, "Effect 1");
        expect(structFromDisplay(group, effectSpecAnnotated, {})).toEqual(sample);
    });

    it("throws when a chars field is missing from the group", () => {
        // Minimal spec with only a chars field; the group is empty.
        const spec = { resref: charsSpec(8) };
        const emptyGroup = { name: "G", fields: [], expanded: true };
        expect(() => structFromDisplay(emptyGroup, spec, {})).toThrow(/resref/);
    });
});
