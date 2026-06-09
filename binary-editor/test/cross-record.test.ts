import { describe, expect, it } from "vitest";
import { buildModel, creResult, findGroupNode } from "./cross-record-fixture";
import { creMeminfoRefConstraint } from "../src/relationship/cross-record";

describe("creMeminfoRefConstraint", () => {
    it("warns + clamps when a meminfo slice runs past the memorized-spell list", () => {
        // 3 memorized spells; one meminfo entry claims [1, 1+5) -> overshoots (end 6 > 3).
        const m = buildModel(creResult({ memSpells: 3, items: 0, slots: [], meminfos: [{ start: 1, count: 5 }] }));
        const diags = creMeminfoRefConstraint(m);
        expect(diags).toHaveLength(1);
        const countNode = findGroupNode(m, "Spell Memorization Info", 0, "Memorized Spell Count");
        expect(diags[0]!.nodeId).toBe(countNode.id);
        expect(diags[0]!.severity).toBe("warning");
        // clamp = max(0, listLen 3 - start 1) = 2
        expect(diags[0]!.quickFix?.edits).toEqual([{ nodeId: countNode.id, value: 2 }]);
    });
    it("no diagnostic when every slice fits", () => {
        const m = buildModel(
            creResult({
                memSpells: 4,
                items: 0,
                slots: [],
                meminfos: [
                    { start: 0, count: 2 },
                    { start: 2, count: 2 },
                ],
            }),
        );
        expect(creMeminfoRefConstraint(m)).toHaveLength(0);
    });
    it("ignores empty (count 0) slices", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 0, slots: [], meminfos: [{ start: 0, count: 0 }] }));
        expect(creMeminfoRefConstraint(m)).toHaveLength(0);
    });
});
