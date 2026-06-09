import type { Diagnostic } from "../types";
import type { FlatNode, Model } from "../model";
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

// Field-name variants across ITM (singular "Block") and SPL (plural "Blocks", "Casting" header).
const ABILITY_START_KEYS = ["featureblockindex", "featureblocksoffset"];
const ABILITY_COUNT_KEYS = ["featureblockcount", "featureblockscount"];
const HEADER_START_KEYS = ["featureblocksindex", "castingfeatureblocksindex"];
const HEADER_COUNT_KEYS = ["featureblockscount", "castingfeatureblockscount"];

function pick(fields: Map<string, FlatNode>, keys: string[]): FlatNode | undefined {
    for (const k of keys) {
        const node = fields.get(k);
        if (node) return node;
    }
    return undefined;
}

interface EffectRange {
    startNode?: FlatNode;
    countNode?: FlatNode;
}

/** Collect every [start, count) range into the flat Effects table: one per ability, plus the header
 *  equipping (ITM) / casting (SPL) range. Shared by the broken-ref and orphan-effects checks. */
function collectEffectRanges(model: Model): EffectRange[] {
    const ranges: EffectRange[] = [];
    const abilities = findGroup(model, "Abilities");
    if (abilities) {
        for (const ability of childGroups(model, abilities)) {
            const f = fieldsByKey(model, ability);
            ranges.push({ startNode: pick(f, ABILITY_START_KEYS), countNode: pick(f, ABILITY_COUNT_KEYS) });
        }
    }
    const header = findGroup(model, "ITM Header") ?? findGroup(model, "SPL Header");
    if (header) {
        const f = fieldsByKey(model, header);
        ranges.push({ startNode: pick(f, HEADER_START_KEYS), countNode: pick(f, HEADER_COUNT_KEYS) });
    }
    return ranges;
}

/** ITM/SPL abilities (and the header equipping/casting range) slice into the shared flat Effects table.
 *  A slice running past the table is a dangling reference: warn on the count field, offer to clamp it. */
export function abilityEffectRefConstraint(model: Model): Diagnostic[] {
    const effGroup = findGroup(model, "Effects");
    if (!effGroup) return [];
    const effLen = childGroups(model, effGroup).length;
    const diags: Diagnostic[] = [];
    for (const r of collectEffectRanges(model)) {
        if (!r.countNode) continue;
        const start = r.startNode ? (fieldNumber(r.startNode) ?? 0) : 0;
        const count = fieldNumber(r.countNode);
        if (count === undefined || count <= 0) continue;
        if (start >= 0 && start + count <= effLen) continue;
        const clamped = Math.max(0, effLen - Math.max(0, start));
        diags.push({
            nodeId: r.countNode.id,
            severity: "warning",
            message: `Effect slice [${start}, ${start + count}) runs past the Effects list (${effLen}).`,
            quickFix: { label: "Clamp count to fit", edits: [{ nodeId: r.countNode.id, value: clamped }] },
        });
    }
    return diags;
}

/** An effect covered by no ability/header range is legal (the flat Effects table is written wholesale, so it
 *  round-trips). Note it as info - never change anything. Coverage set-difference only, not partition hygiene. */
export function orphanEffectsConstraint(model: Model): Diagnostic[] {
    const effGroup = findGroup(model, "Effects");
    if (!effGroup) return [];
    const effLen = childGroups(model, effGroup).length;
    if (effLen === 0) return [];
    const covered = Array.from<boolean>({ length: effLen }).fill(false);
    for (const r of collectEffectRanges(model)) {
        const start = r.startNode ? fieldNumber(r.startNode) : undefined;
        const count = r.countNode ? fieldNumber(r.countNode) : undefined;
        if (start === undefined || count === undefined || count <= 0) continue;
        for (let k = start; k < start + count; k++) if (k >= 0 && k < effLen) covered[k] = true;
    }
    const orphans: number[] = [];
    for (let i = 0; i < effLen; i++) if (!covered[i]) orphans.push(i);
    if (orphans.length === 0) return [];
    return [
        {
            nodeId: effGroup.id,
            severity: "info",
            message: `${orphans.length} unreferenced effect(s) (covered by no ability or equipping/casting range): #${orphans.join(", #")}.`,
        },
    ];
}
