import type { CrossRefRelationship, IndexRefRelationship, SliceRefRelationship } from "@bgforge/binary";
import type { Diagnostic } from "../types";
import type { FlatNode, Model } from "../model";
import { findGroup, childGroups, childFields, fieldsByKey, fieldNumber, normKey } from "./model-helpers";

/**
 * Cross-record consistency diagnostics, driven entirely by the per-format `crossRefRelationship`
 * descriptors declared in `@bgforge/binary`. The descriptors are the single source of truth shared with
 * the edit-time relink, so the diagnostics honor the same field bindings and reference ranges (e.g. CRE's
 * trailing selected-weapon slots are excluded from the item-index check because the descriptor's
 * `refFieldCount` is the same constant the relink uses).
 */

/** Index back-references (CRE Item Slots -> Items): a leading field holding an index >= the target count is a
 *  dangling reference. Warn on that field and offer to clear it (-1). Fields past `refFieldCount` (CRE's
 *  selected-weapon slot/ability entries) are not indices and are skipped. */
export function indexRefDiagnostics(model: Model, rel: IndexRefRelationship): Diagnostic[] {
    const refGroup = findGroup(model, rel.refGroup);
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!refGroup || !targetGroup) return [];
    const targetLen = childGroups(model, targetGroup).length;
    const fields = childFields(model, refGroup);
    const refCount = rel.refFieldCount ?? fields.length;
    const diags: Diagnostic[] = [];
    fields.forEach((slot, i) => {
        if (i >= refCount) return; // trailing non-index fields are not references
        const v = fieldNumber(slot);
        if (v === undefined || v < 0) return; // negative (incl. -1) = empty slot
        if (v < targetLen) return; // valid reference
        diags.push({
            nodeId: slot.id,
            severity: "warning",
            message: `${slot.name} references ${rel.refNoun} #${v} but only ${targetLen} ${rel.refNoun}(s) exist.`,
            quickFix: { label: "Clear slot (-1)", edits: [{ nodeId: slot.id, value: -1 }] },
        });
    });
    return diags;
}

/** A target referenced by no in-range field is legal (e.g. a creature carrying more items than its slots use).
 *  Note it as info - never change anything. The list is written wholesale, so unreferenced targets round-trip. */
export function orphanTargetDiagnostics(model: Model, rel: IndexRefRelationship): Diagnostic[] {
    const refGroup = findGroup(model, rel.refGroup);
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!refGroup || !targetGroup) return [];
    const targetLen = childGroups(model, targetGroup).length;
    if (targetLen === 0) return [];
    const fields = childFields(model, refGroup);
    const refCount = rel.refFieldCount ?? fields.length;
    const referenced = new Set<number>();
    fields.forEach((slot, i) => {
        if (i >= refCount) return;
        const v = fieldNumber(slot);
        if (v !== undefined && v >= 0 && v < targetLen) referenced.add(v);
    });
    const orphans: number[] = [];
    for (let i = 0; i < targetLen; i++) if (!referenced.has(i)) orphans.push(i);
    if (orphans.length === 0) return [];
    return [
        {
            nodeId: targetGroup.id,
            severity: "info",
            message: `${orphans.length} unreferenced ${rel.refNoun}(s) (used by no slot): #${orphans.join(", #")}.`,
        },
    ];
}

interface SliceRange {
    startNode?: FlatNode;
    countNode?: FlatNode;
}

/** Collect every [start, count) range slicing into the target table: one per owner-group child, plus the
 *  optional single header range (ITM/SPL equipping/casting). Field keys come from the descriptor's shared
 *  range-field binding, matched against humanized labels via `normKey`. */
function sliceRanges(model: Model, rel: SliceRefRelationship): SliceRange[] {
    const ranges: SliceRange[] = [];
    const ownerGroup = findGroup(model, rel.ownerGroup);
    if (ownerGroup) {
        const startKey = normKey(rel.fields.abilityStart);
        const countKey = normKey(rel.fields.abilityCount);
        for (const owner of childGroups(model, ownerGroup)) {
            const f = fieldsByKey(model, owner);
            ranges.push({ startNode: f.get(startKey), countNode: f.get(countKey) });
        }
    }
    if (rel.headerGroup && rel.fields.headerStart && rel.fields.headerCount) {
        const headerGroup = findGroup(model, rel.headerGroup);
        if (headerGroup) {
            const f = fieldsByKey(model, headerGroup);
            ranges.push({
                startNode: f.get(normKey(rel.fields.headerStart)),
                countNode: f.get(normKey(rel.fields.headerCount)),
            });
        }
    }
    return ranges;
}

/** Owner/header slices into a shared target table (ITM/SPL abilities -> Effects, CRE memorization info ->
 *  Memorized Spells). A slice running past the table end is a dangling reference: warn on the count field
 *  and offer to clamp the count so the slice fits. */
export function sliceRefDiagnostics(model: Model, rel: SliceRefRelationship): Diagnostic[] {
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!targetGroup) return [];
    const targetLen = childGroups(model, targetGroup).length;
    const diags: Diagnostic[] = [];
    for (const r of sliceRanges(model, rel)) {
        if (!r.countNode) continue;
        const start = r.startNode ? (fieldNumber(r.startNode) ?? 0) : 0;
        const count = fieldNumber(r.countNode);
        if (count === undefined || count <= 0) continue;
        if (start >= 0 && start + count <= targetLen) continue; // in range
        const clamped = Math.max(0, targetLen - Math.max(0, start));
        diags.push({
            nodeId: r.countNode.id,
            severity: "warning",
            message: `${rel.sliceNoun} slice [${start}, ${start + count}) runs past the ${rel.targetGroup} list (${targetLen}).`,
            quickFix: { label: "Clamp count to fit", edits: [{ nodeId: r.countNode.id, value: clamped }] },
        });
    }
    return diags;
}

/** A target covered by no slice is legal (the table is written wholesale, so it round-trips). Note it as info.
 *  Coverage set-difference only, not partition hygiene. */
export function orphanSliceDiagnostics(model: Model, rel: SliceRefRelationship): Diagnostic[] {
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!targetGroup) return [];
    const targetLen = childGroups(model, targetGroup).length;
    if (targetLen === 0) return [];
    const covered = Array.from<boolean>({ length: targetLen }).fill(false);
    for (const r of sliceRanges(model, rel)) {
        const start = r.startNode ? fieldNumber(r.startNode) : undefined;
        const count = r.countNode ? fieldNumber(r.countNode) : undefined;
        if (start === undefined || count === undefined || count <= 0) continue;
        for (let k = start; k < start + count; k++) if (k >= 0 && k < targetLen) covered[k] = true;
    }
    const orphans: number[] = [];
    for (let i = 0; i < targetLen; i++) if (!covered[i]) orphans.push(i);
    if (orphans.length === 0) return [];
    return [
        {
            nodeId: targetGroup.id,
            severity: "info",
            message: `${orphans.length} unreferenced ${rel.sliceNoun.toLowerCase()}(s) (covered by no ability or equipping/casting range): #${orphans.join(", #")}.`,
        },
    ];
}

/** Run every relationship in a format's descriptor list and collect its diagnostics. */
export function crossRefDiagnostics(model: Model, rels: readonly CrossRefRelationship[]): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const rel of rels) {
        if (rel.kind === "index") {
            out.push(...indexRefDiagnostics(model, rel));
            if (rel.orphanInfo) out.push(...orphanTargetDiagnostics(model, rel));
        } else {
            out.push(...sliceRefDiagnostics(model, rel));
            if (rel.orphanInfo) out.push(...orphanSliceDiagnostics(model, rel));
        }
    }
    return out;
}
