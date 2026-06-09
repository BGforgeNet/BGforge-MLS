import type { FlatNode, Model } from "../model";
import type { NodeId } from "../types";
import type { FieldOverride } from "./types";
import { findGroup, childGroups, childFields, fieldsByKey, fieldNumber, fieldText, normKey } from "./model-helpers";

/**
 * CRE "Selected weapon" / "Selected weapon ability" dropdowns. Both live in the Item Slots group (entries 38
 * and 39) but are NOT item-table indices, so the generic item-slot dropdown skips them.
 *
 *  - Selected weapon: the value picks a weapon slot (0-3 = Weapon 1-4, 1000 = fists). The dropdown labels are
 *    document-derived - each weapon option shows the ResRef currently held in that weapon slot (or "None") -
 *    so they refresh when a weapon slot or item is edited (see creWeaponDependents).
 *  - Selected weapon ability: the active ability (extended header) index on the selected weapon. The ability
 *    COUNT lives in the external .itm, not the CRE (IESDP cre_v1.htm documents no count), so the editor offers
 *    a small fixed index range rather than guessing per weapon.
 */

const ITEM_SLOTS = "Item Slots";
const ITEMS = "Items";
const ITEM_LABEL_KEY = "item"; // each Items entry's ResRef field (normalized)
const SELECTED_WEAPON = "selectedweapon";
const SELECTED_WEAPON_ABILITY = "selectedweaponability";
const WEAPON_SLOT_RE = /^weapon[1-4]$/; // normalized "Weapon 1".."Weapon 4"

// Fixed ability-index range 0-2 (see header note: the real count is in the weapon's .itm, not the CRE; most
// weapons have one ability, some ranged/throwing have two, so 0-2 covers the common cases).
const CRE_WEAPON_ABILITY_OPTIONS: Readonly<Record<string, string>> = {
    "0": "Ability 0",
    "1": "Ability 1",
    "2": "Ability 2",
};

/** ResRef of the item held in weapon slot N (1-4), or "None" when empty / out of range. */
function weaponSlotItem(model: Model, slotFields: FlatNode[], items: FlatNode[], weaponNum: number): string {
    const slot = slotFields.find((f) => f.name === `Weapon ${weaponNum}`);
    const idx = slot ? fieldNumber(slot) : undefined;
    if (idx === undefined || idx < 0 || idx >= items.length) return "None";
    const labelField = fieldsByKey(model, items[idx]!).get(ITEM_LABEL_KEY);
    return (labelField && fieldText(labelField)) || "None";
}

/** Document-derived options: each weapon slot labelled with the item it holds, plus the fist sentinel. */
function selectedWeaponOptions(model: Model): Record<string, string> {
    const slotsGroup = findGroup(model, ITEM_SLOTS);
    const itemsGroup = findGroup(model, ITEMS);
    const slotFields = slotsGroup ? childFields(model, slotsGroup) : [];
    const items = itemsGroup ? childGroups(model, itemsGroup) : [];
    const options: Record<string, string> = {};
    // Label each option with the raw STORED value (0-3 = Weapon 1-4, 1000 = fist) plus the item in that
    // weapon slot, consistent with the item dropdown's "<value> <ResRef>" form.
    for (let w = 1; w <= 4; w++) options[String(w - 1)] = `${w - 1} ${weaponSlotItem(model, slotFields, items, w)}`;
    options["1000"] = "1000 Fist";
    return options;
}

/** Turn the Item Slots' selected-weapon / ability entries into dropdowns. Returns undefined for any other field
 *  (including the leading item-index slots, which the generic item-slot dropdown handles). */
export function creWeaponFieldOverride(model: Model, node: FlatNode): FieldOverride | undefined {
    if (node.kind !== "field") return;
    const slotsGroup = findGroup(model, ITEM_SLOTS);
    if (!slotsGroup || node.parentId !== slotsGroup.id) return;
    const key = normKey(node.name);
    if (key === SELECTED_WEAPON) return { presentationType: "enum", enumOptions: selectedWeaponOptions(model) };
    if (key === SELECTED_WEAPON_ABILITY) return { presentationType: "enum", enumOptions: CRE_WEAPON_ABILITY_OPTIONS };
    return undefined;
}

/** Re-project the selected-weapon dropdown when its labels change: an item's ResRef edited, or a weapon slot
 *  (Weapon 1-4) re-pointed. The ability dropdown is static, so it has no dependents. */
export function creWeaponDependents(model: Model, editedNode: FlatNode): NodeId[] {
    if (editedNode.kind !== "field") return [];
    const slotsGroup = findGroup(model, ITEM_SLOTS);
    if (!slotsGroup) return [];
    const selected = childFields(model, slotsGroup).find((f) => normKey(f.name) === SELECTED_WEAPON);
    if (!selected) return [];
    const itemsGroup = findGroup(model, ITEMS);
    const itemEntryIds = new Set((itemsGroup ? childGroups(model, itemsGroup) : []).map((g) => g.id));
    const editedKey = normKey(editedNode.name);
    const isItemResRef =
        editedKey === ITEM_LABEL_KEY && editedNode.parentId !== undefined && itemEntryIds.has(editedNode.parentId);
    const isWeaponSlot = editedNode.parentId === slotsGroup.id && WEAPON_SLOT_RE.test(editedKey);
    return isItemResRef || isWeaponSlot ? [selected.id] : [];
}
