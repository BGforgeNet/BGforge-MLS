import { describe, expect, it } from "vitest";
import { buildModel, creResult, findGroupNode, findGroupNodeField } from "./cross-record-fixture";
import {
    creMeminfoRefConstraint,
    creItemSlotRefConstraint,
    creOrphanItemsConstraint,
} from "../src/relationship/cross-record";

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

describe("creItemSlotRefConstraint", () => {
    it("warns + clears a slot that references a nonexistent item", () => {
        // 2 items (valid indices 0,1); slot 0 -> 3 (out of range), slot 1 -> -1 (empty, ignored).
        const m = buildModel(creResult({ memSpells: 0, items: 2, slots: [3, -1], meminfos: [] }));
        const diags = creItemSlotRefConstraint(m);
        expect(diags).toHaveLength(1);
        const slot0 = findGroupNodeField(m, "Item Slots", "Slot 0");
        expect(diags[0]!.nodeId).toBe(slot0.id);
        expect(diags[0]!.severity).toBe("warning");
        expect(diags[0]!.quickFix?.edits).toEqual([{ nodeId: slot0.id, value: -1 }]);
    });
    it("no diagnostic when all slot indices are valid or empty", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 3, slots: [0, 2, -1], meminfos: [] }));
        expect(creItemSlotRefConstraint(m)).toHaveLength(0);
    });
});

describe("creOrphanItemsConstraint", () => {
    it("emits one info note listing items referenced by no slot", () => {
        // 3 items; slots reference 0 only -> items #1 and #2 are orphans.
        const m = buildModel(creResult({ memSpells: 0, items: 3, slots: [0, -1], meminfos: [] }));
        const diags = creOrphanItemsConstraint(m);
        expect(diags).toHaveLength(1);
        expect(diags[0]!.severity).toBe("info");
        expect(diags[0]!.message).toContain("2 unreferenced");
        expect(diags[0]!.message).toContain("#1");
        expect(diags[0]!.message).toContain("#2");
        expect(diags[0]!.quickFix).toBeUndefined();
        const items = m.nodes.find((n) => n.kind === "group" && n.name === "Items")!;
        expect(diags[0]!.nodeId).toBe(items.id);
    });
    it("no note when every item is referenced", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 2, slots: [0, 1], meminfos: [] }));
        expect(creOrphanItemsConstraint(m)).toHaveLength(0);
    });
    it("no note when there are no items", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 0, slots: [], meminfos: [] }));
        expect(creOrphanItemsConstraint(m)).toHaveLength(0);
    });
});
