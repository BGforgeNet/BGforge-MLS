import type { Diagnostic } from "../types";
import type { Model } from "../model";
import { findGroup, childGroups, childFields, fieldsByKey, fieldNumber } from "./model-helpers";

/** CRE spell-memorization-info entries slice [firstMemorizedSpellIndex, +memorizedSpellCount) into the
 *  Memorized Spells list. A slice running past the list end (or starting past it) is a dangling reference:
 *  warn on the count field and offer to clamp the count so the slice fits. */
export function creMeminfoRefConstraint(model: Model): Diagnostic[] {
    const memGroup = findGroup(model, "Memorized Spells");
    const infoGroup = findGroup(model, "Spell Memorization Info");
    if (!memGroup || !infoGroup) return [];
    const listLen = childGroups(model, memGroup).length;
    const diags: Diagnostic[] = [];
    for (const entry of childGroups(model, infoGroup)) {
        const f = fieldsByKey(model, entry);
        const startField = f.get("firstmemorizedspellindex");
        const countField = f.get("memorizedspellcount");
        if (!startField || !countField) continue;
        const start = fieldNumber(startField);
        const count = fieldNumber(countField);
        if (start === undefined || count === undefined || count <= 0) continue;
        if (start >= 0 && start + count <= listLen) continue; // in range
        const clamped = Math.max(0, listLen - Math.max(0, start));
        diags.push({
            nodeId: countField.id,
            severity: "warning",
            message: `Memorized-spell slice [${start}, ${start + count}) runs past the Memorized Spells list (${listLen}).`,
            quickFix: { label: "Clamp count to fit", edits: [{ nodeId: countField.id, value: clamped }] },
        });
    }
    return diags;
}

/** CRE item slots are int16 indices into the Items list (-1 = empty). An index >= the item count is a dangling
 *  reference: warn on that slot field and offer to clear it (-1). */
export function creItemSlotRefConstraint(model: Model): Diagnostic[] {
    const slotsGroup = findGroup(model, "Item Slots");
    const itemsGroup = findGroup(model, "Items");
    if (!slotsGroup || !itemsGroup) return [];
    const itemsLen = childGroups(model, itemsGroup).length;
    const diags: Diagnostic[] = [];
    for (const slot of childFields(model, slotsGroup)) {
        const v = fieldNumber(slot);
        if (v === undefined || v < 0) continue; // negative (incl. -1) = empty slot
        if (v < itemsLen) continue; // valid reference
        diags.push({
            nodeId: slot.id,
            severity: "warning",
            message: `${slot.name} references item #${v} but only ${itemsLen} item(s) exist.`,
            quickFix: { label: "Clear slot (-1)", edits: [{ nodeId: slot.id, value: -1 }] },
        });
    }
    return diags;
}

/** An item referenced by no slot is legal (e.g. a creature carrying more items than its slots use). Note it as
 *  info - never change anything. The Items list is written wholesale, so orphan items round-trip safely. */
export function creOrphanItemsConstraint(model: Model): Diagnostic[] {
    const slotsGroup = findGroup(model, "Item Slots");
    const itemsGroup = findGroup(model, "Items");
    if (!slotsGroup || !itemsGroup) return [];
    const itemsLen = childGroups(model, itemsGroup).length;
    if (itemsLen === 0) return [];
    const referenced = new Set<number>();
    for (const slot of childFields(model, slotsGroup)) {
        const v = fieldNumber(slot);
        if (v !== undefined && v >= 0 && v < itemsLen) referenced.add(v);
    }
    const orphans: number[] = [];
    for (let i = 0; i < itemsLen; i++) if (!referenced.has(i)) orphans.push(i);
    if (orphans.length === 0) return [];
    return [
        {
            nodeId: itemsGroup.id,
            severity: "info",
            message: `${orphans.length} unreferenced item(s) (used by no slot): #${orphans.join(", #")}.`,
        },
    ];
}
