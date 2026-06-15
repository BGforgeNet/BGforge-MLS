/**
 * Compound CRE spellbook structural edits. Each op adds an entry and presets its fields in one atomic commit
 * (one undo entry), so a spell lands in the right level/type without the user touching a flat list. Removal
 * ops (unmemorize a slot, remove a known spell) are plain `structureOp` removes - the webview posts those
 * directly - so this module only covers the compound adds.
 *
 * The pattern mirrors `editField`: build the add bytes, reparse, then mutate the new entry's field
 * value/rawValue in the rebuilt model before committing. `commitModel` invalidates the cached document so
 * serialize rebuilds from the mutated display tree.
 */
import {
    buildCreMemorizeBytes,
    buildCreRemoveOrphanMemorizedBytes,
    formatAdapterRegistry,
    type ParsedField,
} from "@bgforge/binary";
import { buildModel, type FlatNode, type Model } from "./model";
import { commitModel, noopResult, reparse } from "./structure-ops";
import { childGroups, fieldsByKey, fieldNumber, findGroup, normKey } from "./relationship/model-helpers";
import type { EditorSession } from "./session";
import type { NodeId, StructureResult } from "./types";

export type SpellbookEditOp =
    | { op: "memorize"; ownerNodeId: NodeId; resref: string }
    | { op: "addKnown"; spellType: number; spellLevel: number; resref: string }
    | { op: "addLevel"; spellType: number; spellLevel: number }
    | { op: "removeOrphan"; memorizedIndex: number };

const KNOWN_SECTION = "Known Spells";
const MEMINFO_SECTION = "Spell Memorization Info";
const MEMORIZED_SECTION = "Memorized Spells";
const MEMORIZED_FLAG = 1; // CreMemorizedSpellFlags bit0 = Memorized

/** Set a field (by humanized name) on a group's child to `value`, mutating value AND rawValue - the same
 *  contract `editField` uses, so an enum/flag field carries its numeric code and serialize encodes it. */
function setField(model: Model, group: FlatNode, fieldName: string, value: number | string): void {
    const node = fieldsByKey(model, group).get(normKey(fieldName));
    if (!node) return;
    const src = node.source as ParsedField;
    src.value = value;
    src.rawValue = value;
}

const lastChildGroup = (model: Model, section: string): FlatNode | undefined => {
    const group = findGroup(model, section);
    if (!group) return undefined;
    const kids = childGroups(model, group);
    return kids[kids.length - 1];
};

export function spellbookEdit(session: EditorSession, op: SpellbookEditOp): StructureResult {
    const adapter = formatAdapterRegistry.get(session.parserId);
    const pr = session.model.parseResult;

    if (op.op === "memorize") {
        const meminfo = findGroup(session.model, MEMINFO_SECTION);
        if (!meminfo) return noopResult(session);
        const owners = childGroups(session.model, meminfo);
        const ownerIndex = owners.findIndex((o) => o.id === op.ownerNodeId);
        if (ownerIndex === -1) return noopResult(session);
        // The new slice lands at the END of this owner's range (start + count) - the position the byte builder
        // appends at - so we can locate it in the rebuilt model to preset its resref + Memorized flag.
        const f = fieldsByKey(session.model, owners[ownerIndex]!);
        const start =
            (f.get(normKey("First Memorized Spell Index")) &&
                fieldNumber(f.get(normKey("First Memorized Spell Index"))!)) ??
            0;
        const count =
            (f.get(normKey("Memorized Spell Count")) && fieldNumber(f.get(normKey("Memorized Spell Count"))!)) ?? 0;
        const base = (f.get(normKey("Num Memorizable")) && fieldNumber(f.get(normKey("Num Memorizable"))!)) ?? 0;
        const eff =
            (f.get(normKey("Num Memorizable Effective")) &&
                fieldNumber(f.get(normKey("Num Memorizable Effective"))!)) ??
            0;
        const at = start + count;
        const bytes = buildCreMemorizeBytes(pr, ownerIndex);
        if (!bytes) return noopResult(session);
        const model = buildModel(reparse(session, bytes));
        const memorized = findGroup(model, MEMORIZED_SECTION);
        const newSlice = memorized ? childGroups(model, memorized)[at] : undefined;
        if (newSlice) {
            setField(model, newSlice, "Spell", op.resref);
            setField(model, newSlice, "Memorized Flags", MEMORIZED_FLAG);
        }
        // Memorizing past effective capacity auto-raises base + effective slots by 1 each so capacity keeps pace
        // (the owner index is stable - memorize adds no rows). Only ever increases: removing a spell never lowers
        // capacity, so a deliberately-set capacity is not silently eroded.
        if (count + 1 > eff) {
            const newMeminfo = findGroup(model, MEMINFO_SECTION);
            const newOwner = newMeminfo ? childGroups(model, newMeminfo)[ownerIndex] : undefined;
            if (newOwner) {
                setField(model, newOwner, "Num Memorizable", base + 1);
                setField(model, newOwner, "Num Memorizable Effective", eff + 1);
            }
        }
        const result = commitModel(session, `Memorize ${op.resref}`, model);
        result.selection = newSlice?.id;
        return result;
    }

    if (op.op === "addKnown") {
        const bytes = adapter?.buildAddEntryBytes?.(pr, [KNOWN_SECTION]);
        if (!bytes) return noopResult(session);
        const model = buildModel(reparse(session, bytes));
        const entry = lastChildGroup(model, KNOWN_SECTION);
        if (entry) {
            setField(model, entry, "Spell Level", op.spellLevel);
            setField(model, entry, "Spell Type", op.spellType);
            setField(model, entry, "Spell", op.resref);
        }
        const result = commitModel(session, "Add known spell", model);
        result.selection = entry?.id;
        return result;
    }

    if (op.op === "removeOrphan") {
        const bytes = buildCreRemoveOrphanMemorizedBytes(pr, op.memorizedIndex);
        if (!bytes) return noopResult(session);
        return commitModel(session, "Remove orphan memorized spell", buildModel(reparse(session, bytes)));
    }

    // addLevel: a new memorization row (owner) with an empty range, tagged to the requested level/type. The UI
    // only offers levels with no existing row, so this normally adds a genuinely-absent level. Guard the
    // invariant "at most one row per (type, level)" anyway: a double-click fires addLevel twice for the same
    // target before the view refreshes; dispatches are sequential, so the second call sees the first's
    // committed row and no-ops rather than creating the "more than one memorization row" inconsistency.
    const meminfoGroup = findGroup(session.model, MEMINFO_SECTION);
    const dupRow =
        meminfoGroup &&
        childGroups(session.model, meminfoGroup).some((row) => {
            const rf = fieldsByKey(session.model, row);
            const t = rf.get(normKey("Spell Type"));
            const l = rf.get(normKey("Spell Level"));
            return (
                t !== undefined &&
                l !== undefined &&
                fieldNumber(t) === op.spellType &&
                fieldNumber(l) === op.spellLevel
            );
        });
    if (dupRow) return noopResult(session);
    const bytes = adapter?.buildAddEntryBytes?.(pr, [MEMINFO_SECTION]);
    if (!bytes) return noopResult(session);
    const model = buildModel(reparse(session, bytes));
    const entry = lastChildGroup(model, MEMINFO_SECTION);
    if (entry) {
        setField(model, entry, "Spell Level", op.spellLevel);
        setField(model, entry, "Spell Type", op.spellType);
        // Seed one slot (base + effective) so the added level is immediately usable - it shows one empty slot
        // ready to fill rather than an inert zero-capacity row. A UI default; the user can change the counts.
        setField(model, entry, "Num Memorizable", 1);
        setField(model, entry, "Num Memorizable Effective", 1);
    }
    const result = commitModel(session, "Add memorization level", model);
    result.selection = entry?.id;
    return result;
}
