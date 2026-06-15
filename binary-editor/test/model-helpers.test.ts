import { describe, expect, it } from "vitest";
import type { ParseResult } from "@bgforge/binary";
import { buildModel } from "../src/model";
import {
    findGroup,
    childGroups,
    childFields,
    fieldsByKey,
    fieldNumber,
    normKey,
} from "../src/relationship/model-helpers";

// Synthetic ParseResult: a "Things" group with two child groups, and a "Slots" group with two int fields.
// Cast to ParseResult - this is a structural subset (buildModel reads only `format` and `root.fields`);
// the "cre" adapter defines no hide/projection hooks, so projection is identity.
function result(): ParseResult {
    return {
        format: "cre",
        formatName: "CRE",
        root: {
            name: "CRE File",
            fields: [
                {
                    name: "Things",
                    fields: [
                        { name: "Thing 1", fields: [{ name: "A", value: 1 }] },
                        { name: "Thing 2", fields: [{ name: "B", value: 2 }] },
                    ],
                },
                {
                    name: "Slots",
                    fields: [
                        { name: "Slot 0", value: 5 },
                        { name: "Slot 1", value: -1 },
                    ],
                },
            ],
        },
    } as unknown as ParseResult;
}

describe("relationship model-helpers", () => {
    it("normKey strips case and non-alphanumerics", () => {
        expect(normKey("Memorized Spell Count")).toBe("memorizedspellcount");
    });
    it("findGroup + childGroups + childFields navigate the flat model", () => {
        const m = buildModel(result());
        const things = findGroup(m, "Things");
        const slots = findGroup(m, "Slots");
        expect(things).toBeDefined();
        expect(childGroups(m, things!).length).toBe(2);
        expect(childFields(m, slots!).length).toBe(2);
        expect(findGroup(m, "Nope")).toBeUndefined();
    });
    it("fieldNumber reads rawValue then value; fieldsByKey keys by normKey", () => {
        const m = buildModel(result());
        const slots = findGroup(m, "Slots")!;
        const byKey = fieldsByKey(m, slots);
        expect(fieldNumber(byKey.get("slot0")!)).toBe(5);
        expect(fieldNumber(byKey.get("slot1")!)).toBe(-1);
    });
});
