import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, type IndexRefRelationship, type SliceRefRelationship } from "@bgforge/binary";
import { buildModel, creResult, findGroupNode, findGroupNodeField } from "./cross-record-fixture";
import { indexRefDiagnostics, orphanTargetDiagnostics, sliceRefDiagnostics } from "../src/relationship/cross-record";
import { getRelationshipModel } from "../src/relationship/registry";

// The real CRE relationship descriptors (single source of truth, declared on the cre adapter in @bgforge/binary).
const creRels = formatAdapterRegistry.get("cre")!.crossRefRelationships!;
const creItemSlotRel = creRels.find((r) => r.kind === "index") as IndexRefRelationship;
const creMeminfoRel = creRels.find((r) => r.kind === "slice") as SliceRefRelationship;

/** Build a full 40-entry CRE inventory: slots 0-37 are item-table indices (-1 = empty), slot 38 is the
 *  selected-weapon slot index (1000 = fists), slot 39 the selected-weapon ability index. */
function fullInventory(overrides: Record<number, number>): number[] {
    const slots = Array.from<number>({ length: 40 }).fill(-1);
    for (const [i, v] of Object.entries(overrides)) slots[Number(i)] = v;
    return slots;
}

describe("creMeminfoRefConstraint", () => {
    it("warns + clamps when a meminfo slice runs past the memorized-spell list", () => {
        // 3 memorized spells; one meminfo entry claims [1, 1+5) -> overshoots (end 6 > 3).
        const m = buildModel(creResult({ memSpells: 3, items: 0, slots: [], meminfos: [{ start: 1, count: 5 }] }));
        const diags = sliceRefDiagnostics(m, creMeminfoRel);
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
        expect(sliceRefDiagnostics(m, creMeminfoRel)).toHaveLength(0);
    });
    it("ignores empty (count 0) slices", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 0, slots: [], meminfos: [{ start: 0, count: 0 }] }));
        expect(sliceRefDiagnostics(m, creMeminfoRel)).toHaveLength(0);
    });
});

describe("creItemSlotRefConstraint", () => {
    it("warns + clears a slot that references a nonexistent item", () => {
        // 2 items (valid indices 0,1); slot 0 -> 3 (out of range), slot 1 -> -1 (empty, ignored).
        const m = buildModel(creResult({ memSpells: 0, items: 2, slots: [3, -1], meminfos: [] }));
        const diags = indexRefDiagnostics(m, creItemSlotRel);
        expect(diags).toHaveLength(1);
        const slot0 = findGroupNodeField(m, "Item Slots", "Slot 0");
        expect(diags[0]!.nodeId).toBe(slot0.id);
        expect(diags[0]!.severity).toBe("warning");
        expect(diags[0]!.quickFix?.edits).toEqual([{ nodeId: slot0.id, value: -1 }]);
    });
    it("no diagnostic when all slot indices are valid or empty", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 3, slots: [0, 2, -1], meminfos: [] }));
        expect(indexRefDiagnostics(m, creItemSlotRel)).toHaveLength(0);
    });
});

describe("creOrphanItemsConstraint", () => {
    it("emits one info note listing items referenced by no slot", () => {
        // 3 items; slots reference 0 only -> items #1 and #2 are orphans.
        const m = buildModel(creResult({ memSpells: 0, items: 3, slots: [0, -1], meminfos: [] }));
        const diags = orphanTargetDiagnostics(m, creItemSlotRel);
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
        expect(orphanTargetDiagnostics(m, creItemSlotRel)).toHaveLength(0);
    });
    it("no note when there are no items", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 0, slots: [], meminfos: [] }));
        expect(orphanTargetDiagnostics(m, creItemSlotRel)).toHaveLength(0);
    });
});

describe("CRE item-slot references: trailing selected-weapon slots are not item indices", () => {
    // Slots 38 ("Selected weapon", 1000 = fists) and 39 ("Selected weapon ability") hold a slot index and an
    // ability index, NOT item-table indices, so they must never be validated against the item count. A fist-
    // fighting creature (slot 38 = 1000) would otherwise be reported as "references item #1000".
    it("does not flag slots 38/39 as dangling item references", () => {
        const slots = fullInventory({ 0: 0, 38: 1000, 39: 2 }); // 1 item, slot 0 valid; 38/39 out-of-item-range
        const m = buildModel(creResult({ memSpells: 0, items: 1, slots, meminfos: [] }));
        const diags = getRelationshipModel("cre")!.constraints(m);
        const slot38 = findGroupNodeField(m, "Item Slots", "Slot 38");
        const slot39 = findGroupNodeField(m, "Item Slots", "Slot 39");
        const offending = diags.filter((d) => d.nodeId === slot38.id || d.nodeId === slot39.id);
        expect(offending).toEqual([]);
    });
});
