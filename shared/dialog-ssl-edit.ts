/**
 * Surgical in-place editor for Fallout SSL dialog source (Tier 1: retarget + reorder).
 *
 * SSL is a full scripting language, so the graph is only an approximation of a procedure. Only
 * nodes the graph represents *faithfully* (flat dialog calls + single-level `if`, no else/loop/
 * nested-if/assignment - see `SSLDialogNode.faithful`) are structurally editable; an edit to a
 * non-faithful node is ignored so we never corrupt control flow the graph never captured.
 *
 * Tier 1 only rearranges or rewrites bytes that already exist - it needs no code generation and no
 * `.msg` id allocation (those are Tier 2). Each faithful node's options occupy fixed byte "slots"
 * (their original `callRange`s, in source order); an edit re-fills each slot with the call text of
 * the option that now belongs there, substituting the target token when an option was retargeted.
 * Because every splice replaces a whole slot, retarget and reorder compose without overlapping.
 */

import type { DialogChoice, DialogModel, DialogState } from "./dialog-model";
import { applySplices, type SpliceOp } from "./dialog-splice";

/** The new target token for an option, or null when it cannot be expressed as a target-Node arg. */
function targetToken(choice: DialogChoice): string | null {
    return choice.target.kind === "state" ? choice.target.stateId : null;
}

/** Options of a state in source order: the choices that carry a `callRange` (call transitions don't). */
function optionsOf(state: DialogState): DialogChoice[] {
    return state.choices.filter((c) => c.callRange);
}

/**
 * Build the splice ops for one faithful node. Each original option slot (source order) is refilled
 * with the call text of the option that the edited order places there, with its target substituted
 * if it changed. Returns no ops when the option count changed (add/remove is Tier 2, not Tier 1).
 */
function nodeOps(text: string, edited: DialogState, orig: DialogState): SpliceOp[] {
    const origOpts = optionsOf(orig);
    const editedOpts = optionsOf(edited);
    if (origOpts.length === 0 || origOpts.length !== editedOpts.length) return [];

    const origById = new Map(origOpts.map((c) => [c.id, c]));
    const ops: SpliceOp[] = [];

    for (let i = 0; i < origOpts.length; i++) {
        const slot = origOpts[i]!.callRange!;
        const moved = editedOpts[i]!;
        const movedOrig = origById.get(moved.id);
        if (!movedOrig?.callRange || !movedOrig.targetRange) return []; // shape we can't splice safely

        // Start from the moved option's original call text, then substitute its target token if the
        // edit retargeted it. Offsets are taken relative to the moved option's own call span.
        const base = text.slice(movedOrig.callRange.start, movedOrig.callRange.end);
        const newTarget = targetToken(moved);
        const oldTarget = text.slice(movedOrig.targetRange.start, movedOrig.targetRange.end);
        let replacement = base;
        if (newTarget !== null && newTarget !== oldTarget) {
            const relStart = movedOrig.targetRange.start - movedOrig.callRange.start;
            const relEnd = movedOrig.targetRange.end - movedOrig.callRange.start;
            replacement = base.slice(0, relStart) + newTarget + base.slice(relEnd);
        }

        const current = text.slice(slot.start, slot.end);
        if (replacement !== current) ops.push({ start: slot.start, end: slot.end, replacement });
    }
    return ops;
}

/**
 * Write SSL structural edits (retarget, reorder) back to the `.ssl` source. Diffs `edited` against
 * `original` (matched by state id), builds byte splices from the captured option ranges, and applies
 * them. Only faithful nodes are eligible; an edit to a non-faithful node is silently skipped (its
 * structure is read-only). Returns the original text unchanged when there is nothing to splice.
 *
 * @throws if `edited.format !== "fallout-ssl"`.
 */
export function applySSLDialogEdits(originalText: string, edited: DialogModel, original: DialogModel): string {
    if (edited.format !== "fallout-ssl") {
        throw new Error("applySSLDialogEdits: only fallout-ssl models are supported");
    }
    const origById = new Map(original.roots.flatMap((r) => r.states).map((s) => [s.id, s]));
    const ops: SpliceOp[] = [];
    for (const state of edited.roots.flatMap((r) => r.states)) {
        const orig = origById.get(state.id);
        if (!orig || !orig.faithful) continue; // gate: only faithful nodes are structurally editable
        ops.push(...nodeOps(originalText, state, orig));
    }
    return applySplices(originalText, ops);
}
