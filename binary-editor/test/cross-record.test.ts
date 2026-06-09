import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, type IndexRefRelationship, type SliceRefRelationship } from "@bgforge/binary";
import { buildModel, creResult, findGroupNode, findGroupNodeField } from "./cross-record-fixture";
import {
    indexRefDiagnostics,
    indexRefFieldOverride,
    orphanTargetDiagnostics,
    sliceRefDiagnostics,
} from "../src/relationship/cross-record";
import { getRelationshipModel } from "../src/relationship/registry";
import { projectRow } from "../src/window";

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

describe("CRE item-slot dropdowns: index references render as named-item enums", () => {
    // Item Slots [0, CRE_ITEM_REF_SLOT_COUNT) index into the Items list. Rendering them as a dropdown of the
    // actual items (plus a NONE entry for -1 = empty) is the view-side complement of the index relationship:
    // the descriptor's `targetLabelField` ("item" ResRef) is the same single source of truth the diagnostic
    // and relink key on, so the dropdown excludes the trailing selected-weapon slots automatically.
    function inventory(): ReturnType<typeof buildModel> {
        const slots = fullInventory({ 0: 1, 1: -1, 2: 0, 38: 1000, 39: 0 });
        return buildModel(creResult({ memSpells: 0, items: 2, slots, meminfos: [], itemNames: ["SW1H01", "BOW03"] }));
    }
    it("builds a NONE/-1 + indexed-ResRef enum for an in-range slot", () => {
        const ov = indexRefFieldOverride(
            inventory(),
            findGroupNodeField(inventory(), "Item Slots", "Slot 0"),
            creItemSlotRel,
        );
        expect(ov?.presentationType).toBe("enum");
        expect(ov?.enumOptions).toEqual({ "-1": "-1 None", "0": "0 SW1H01", "1": "1 BOW03" });
    });
    it("renders through projectRow as an enum dropdown row", () => {
        const m = inventory();
        const row = projectRow(m, findGroupNodeField(m, "Item Slots", "Slot 2"), getRelationshipModel("cre"));
        expect(row.valueType).toBe("enum");
        expect(row.enumOptions).toEqual({ "-1": "-1 None", "0": "0 SW1H01", "1": "1 BOW03" });
    });
    it("leaves selected-weapon slots 38/39 as plain numeric fields", () => {
        const m = inventory();
        for (const name of ["Slot 38", "Slot 39"]) {
            const slot = findGroupNodeField(m, "Item Slots", name);
            expect(indexRefFieldOverride(m, slot, creItemSlotRel)).toBeUndefined();
            expect(projectRow(m, slot, getRelationshipModel("cre")).enumOptions).toBeUndefined();
        }
    });
    it("still offers NONE/-1 when the creature carries no items", () => {
        const m = buildModel(creResult({ memSpells: 0, items: 0, slots: fullInventory({ 0: -1 }), meminfos: [] }));
        const ov = indexRefFieldOverride(m, findGroupNodeField(m, "Item Slots", "Slot 0"), creItemSlotRel);
        expect(ov?.enumOptions).toEqual({ "-1": "-1 None" });
    });
    it("re-projects in-range slots (not 38/39) when an item's ResRef is edited", () => {
        // Editing an item's ResRef changes every slot dropdown's label, so the slots are dependents of the
        // item label field - the edit pipeline re-projects them. The trailing selected-weapon slots are not
        // item dropdowns, so they are excluded.
        const m = inventory();
        const deps = getRelationshipModel("cre")!.dependents(m, findGroupNode(m, "Items", 0, "Item"));
        expect(deps).toContain(findGroupNodeField(m, "Item Slots", "Slot 0").id);
        expect(deps).toContain(findGroupNodeField(m, "Item Slots", "Slot 37").id);
        expect(deps).not.toContain(findGroupNodeField(m, "Item Slots", "Slot 38").id);
    });
});

describe("CRE selected-weapon / ability dropdowns (document-derived, via projection)", () => {
    // Asserts through projectRow + the composed CRE relationship model - the exact path the editor renders
    // from (controlKind reads row.valueType/enumOptions). Real slot labels so the override's name-matching is
    // exercised faithfully.
    function weaponModel(): ReturnType<typeof buildModel> {
        // Weapon 1 (slot 9) holds item 0 (SW1H01); Weapon 2-4 empty; selected = Weapon 1 (38=0); ability 1 (39=1).
        const slots = fullInventory({ 9: 0, 10: -1, 38: 0, 39: 1 });
        return buildModel(
            creResult({
                memSpells: 0,
                items: 2,
                slots,
                meminfos: [],
                itemNames: ["SW1H01", "BOW03"],
                realSlotLabels: true,
            }),
        );
    }
    it("selected weapon is a dropdown labelled with the item each weapon slot holds", () => {
        const m = weaponModel();
        const row = projectRow(m, findGroupNodeField(m, "Item Slots", "Selected weapon"), getRelationshipModel("cre"));
        expect(row.valueType).toBe("enum");
        expect(row.enumOptions).toEqual({
            "0": "0 SW1H01",
            "1": "1 None",
            "2": "2 None",
            "3": "3 None",
            "1000": "1000 Fist",
        });
    });
    it("selected weapon ability is a fixed-range dropdown", () => {
        const m = weaponModel();
        const row = projectRow(
            m,
            findGroupNodeField(m, "Item Slots", "Selected weapon ability"),
            getRelationshipModel("cre"),
        );
        expect(row.valueType).toBe("enum");
        expect(row.enumOptions).toEqual({ "0": "Ability 0", "1": "Ability 1", "2": "Ability 2" });
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
