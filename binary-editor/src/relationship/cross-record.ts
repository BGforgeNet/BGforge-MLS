import type { CrossRefRelationship, IndexRefRelationship, SliceRefRelationship } from "@bgforge/binary";
import type { Diagnostic, NodeId } from "../types";
import type { FieldOverride } from "./types";
import type { FlatNode, Model } from "../model";
import { findGroup, childGroups, childFields, fieldsByKey, fieldNumber, fieldText, normKey } from "./model-helpers";

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

/** A target referenced by more than one in-range field. With `uniqueRef` set (CRE Item Slots -> Items, where an
 *  item table entry belongs in a single inventory slot) that is a duplicate assignment the editor never creates
 *  - it can only arrive on load from a hand-authored / external CRE - so note it as info. Off when the
 *  relationship does not require uniqueness (multiple references are legal). */
export function duplicateIndexRefDiagnostics(model: Model, rel: IndexRefRelationship): Diagnostic[] {
    if (!rel.uniqueRef) return [];
    const refGroup = findGroup(model, rel.refGroup);
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!refGroup || !targetGroup) return [];
    const targetLen = childGroups(model, targetGroup).length;
    const counts = new Map<number, number>();
    for (const slot of inRangeRefFields(model, rel)) {
        const v = fieldNumber(slot);
        if (v !== undefined && v >= 0 && v < targetLen) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const dups: number[] = [];
    for (const [v, n] of counts) if (n > 1) dups.push(v);
    if (dups.length === 0) return [];
    dups.sort((a, b) => a - b);
    return [
        {
            nodeId: refGroup.id,
            severity: "info",
            message: `${dups.length} ${rel.refNoun}(s) assigned to more than one slot: #${dups.join(", #")}.`,
        },
    ];
}

/** The in-range referring fields of an index relationship (CRE slots 0..refFieldCount), in order. The trailing
 *  non-index fields (CRE's selected-weapon slot/ability) are excluded - the same boundary the diagnostic uses. */
function inRangeRefFields(model: Model, rel: IndexRefRelationship): FlatNode[] {
    const refGroup = findGroup(model, rel.refGroup);
    if (!refGroup) return [];
    const fields = childFields(model, refGroup);
    const refCount = rel.refFieldCount ?? fields.length;
    return fields.slice(0, refCount);
}

/** Display overlay turning an in-range index field into a dropdown of the named targets: a `NONE` entry for
 *  the empty sentinel (-1) plus one `i: <label>` per target entry, labelled by the relationship's
 *  `targetLabelField` (e.g. the item ResRef). Returns undefined when `node` is not an in-range referring field
 *  or the relationship declares no label field, leaving the field a plain number. View-only: the stored int16
 *  index is unchanged, so byte round-trip is unaffected. */
export function indexRefFieldOverride(
    model: Model,
    node: FlatNode,
    rel: IndexRefRelationship,
): FieldOverride | undefined {
    if (rel.targetLabelField === undefined || node.kind !== "field") return;
    if (!inRangeRefFields(model, rel).some((f) => f.id === node.id)) return;
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!targetGroup) return;
    const labelKey = normKey(rel.targetLabelField);
    // Bare option names; the view (enumOptionList) prefixes each with its stored value, so an in-range slot
    // reads "<index> <ResRef>" and the empty sentinel reads "-1 None". A target with no ResRef has a blank
    // name and renders as just its index.
    const enumOptions: Record<string, string> = { "-1": "None" };
    childGroups(model, targetGroup).forEach((entry, i) => {
        const labelField = fieldsByKey(model, entry).get(labelKey);
        const label = labelField ? fieldText(labelField) : undefined;
        enumOptions[String(i)] = label ?? "";
    });
    return { presentationType: "enum", enumOptions };
}

/** Default owning-slice noun for the orphan/overlap messages, matching the ITM/SPL relationships (abilities +
 *  the equipping/casting header range). A relationship's `coverageNoun` overrides it (CRE: "memorization range"). */
const DEFAULT_COVERAGE_NOUN = "ability or equipping/casting range";

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
            message: `${orphans.length} unreferenced ${rel.sliceNoun.toLowerCase()}(s) (covered by no ${rel.coverageNoun ?? DEFAULT_COVERAGE_NOUN}): #${orphans.join(", #")}.`,
        },
    ];
}

/** Two slices covering a common target index mean the entry is claimed by more than one owner (e.g. a memorized
 *  spell assigned to two memorization ranges) - a genuine inconsistency the engine would mis-count. Report the
 *  over-claimed targets as a warning; which owner should keep the entry is the user's call, so there is no
 *  unambiguous auto-fix and no quickFix. Opt-in via the relationship's `overlapWarn`. */
export function overlapSliceDiagnostics(model: Model, rel: SliceRefRelationship): Diagnostic[] {
    const targetGroup = findGroup(model, rel.targetGroup);
    if (!targetGroup) return [];
    const targetLen = childGroups(model, targetGroup).length;
    if (targetLen === 0) return [];
    const coverCount = Array.from<number>({ length: targetLen }).fill(0);
    for (const r of sliceRanges(model, rel)) {
        const start = r.startNode ? fieldNumber(r.startNode) : undefined;
        const count = r.countNode ? fieldNumber(r.countNode) : undefined;
        if (start === undefined || count === undefined || count <= 0) continue;
        for (let k = start; k < start + count; k++) if (k >= 0 && k < targetLen) coverCount[k]!++;
    }
    const overlapped: number[] = [];
    for (let i = 0; i < targetLen; i++) if ((coverCount[i] ?? 0) > 1) overlapped.push(i);
    if (overlapped.length === 0) return [];
    return [
        {
            nodeId: targetGroup.id,
            severity: "warning",
            message: `${overlapped.length} ${rel.sliceNoun.toLowerCase()}(s) claimed by more than one ${rel.coverageNoun ?? DEFAULT_COVERAGE_NOUN}: #${overlapped.join(", #")}.`,
        },
    ];
}

/** First index-reference dropdown override matching `node` across a format's relationships, or undefined.
 *  (Only `index` relationships carrying a `targetLabelField` produce a dropdown; slices never do.) */
export function crossRefFieldOverride(
    model: Model,
    node: FlatNode,
    rels: readonly CrossRefRelationship[],
): FieldOverride | undefined {
    for (const rel of rels) {
        if (rel.kind !== "index") continue;
        const ov = indexRefFieldOverride(model, node, rel);
        if (ov) return ov;
    }
    return undefined;
}

/** When `editedNode` is a target entry's label field (an item ResRef), every in-range referring field's
 *  dropdown label is now stale - return those field ids so the edit pipeline re-projects them. */
export function crossRefDependents(
    model: Model,
    editedNode: FlatNode,
    rels: readonly CrossRefRelationship[],
): NodeId[] {
    if (editedNode.kind !== "field") return [];
    const out: NodeId[] = [];
    for (const rel of rels) {
        if (rel.kind !== "index" || rel.targetLabelField === undefined) continue;
        if (normKey(editedNode.name) !== normKey(rel.targetLabelField)) continue;
        const targetGroup = findGroup(model, rel.targetGroup);
        if (!targetGroup) continue;
        const entryIds = new Set(childGroups(model, targetGroup).map((entry) => entry.id));
        if (editedNode.parentId === undefined || !entryIds.has(editedNode.parentId)) continue;
        for (const slot of inRangeRefFields(model, rel)) out.push(slot.id);
    }
    return out;
}

/** Edit-time cascade for a `uniqueRef` index relationship: when `editedNode` is an in-range slot now holding a
 *  target index, every OTHER in-range slot holding that same index must be cleared (-1) so the reassignment
 *  leaves the item in a single slot. `editedNode` already carries its new value (the edit pipeline applies it
 *  before asking for the cascade), so the duplicates are read straight off the model. Empty/negative values and
 *  non-`uniqueRef` relationships produce no cascade; the trailing selected-weapon slots are out of range and
 *  excluded automatically by `inRangeRefFields`. */
export function crossRefCascade(
    model: Model,
    editedNode: FlatNode,
    rels: readonly CrossRefRelationship[],
): { nodeId: NodeId; value: number }[] {
    if (editedNode.kind !== "field") return [];
    const edits: { nodeId: NodeId; value: number }[] = [];
    for (const rel of rels) {
        if (rel.kind !== "index" || !rel.uniqueRef) continue;
        const fields = inRangeRefFields(model, rel);
        if (!fields.some((f) => f.id === editedNode.id)) continue;
        const v = fieldNumber(editedNode);
        if (v === undefined || v < 0) continue; // empty/cleared slot: nothing to dedupe against
        for (const slot of fields) {
            if (slot.id === editedNode.id) continue;
            if (fieldNumber(slot) === v) edits.push({ nodeId: slot.id, value: -1 });
        }
    }
    return edits;
}

/** Run every relationship in a format's descriptor list and collect its diagnostics. */
export function crossRefDiagnostics(model: Model, rels: readonly CrossRefRelationship[]): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const rel of rels) {
        if (rel.kind === "index") {
            out.push(...indexRefDiagnostics(model, rel));
            if (rel.orphanInfo) out.push(...orphanTargetDiagnostics(model, rel));
            if (rel.uniqueRef) out.push(...duplicateIndexRefDiagnostics(model, rel));
        } else {
            out.push(...sliceRefDiagnostics(model, rel));
            if (rel.orphanInfo) out.push(...orphanSliceDiagnostics(model, rel));
            if (rel.overlapWarn) out.push(...overlapSliceDiagnostics(model, rel));
        }
    }
    return out;
}
