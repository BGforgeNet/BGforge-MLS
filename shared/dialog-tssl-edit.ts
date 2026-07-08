/**
 * TSSL surgical source editor: splices field edits back into the `.tssl` TypeScript SOURCE using the byte
 * ranges the source parser recorded (ranges into the .tssl, not generated SSL). Mirrors `applySSLDialogEdits`
 * but over TS syntax; because a TSSL option call is byte-identical to SSL (`NOption(101, Node002, 4)`), the
 * per-field token splices (retarget, ...) are the same - only the node wrapper and block syntax differ, which
 * field edits do not touch. Structural edits (add/remove node/option) are Phase 3.
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import type { DialogChoice, DialogModel } from "./dialog-model";

function statesOf(model: DialogModel): DialogChoice[] {
    // Flatten every choice across roots/states for id-keyed diffing.
    return model.roots.flatMap((r) => r.states).flatMap((s) => s.choices);
}

/**
 * Compute the `.tssl` source with the model's surgical field edits applied. Currently: option RETARGET
 * (an option whose target node id changed splices its recorded `targetRange` with the new id). Returns the
 * text unchanged when nothing surgical changed.
 *
 * @throws if `edited.sourceLang !== "tssl"` - a D/SSL/TD model must not be serialized as TSSL.
 */
export function applyTSSLDialogEdits(originalText: string, edited: DialogModel, original: DialogModel): string {
    if (edited.sourceLang !== "tssl") {
        throw new Error("applyTSSLDialogEdits: only tssl source models are supported");
    }
    const origById = new Map(statesOf(original).map((c) => [c.id, c]));
    const ops: SpliceOp[] = [];
    for (const c of statesOf(edited)) {
        const orig = origById.get(c.id);
        if (!orig) continue;
        // Retarget: an option's target node changed and the parser recorded the target token's span.
        if (
            c.target.kind === "state" &&
            orig.target.kind === "state" &&
            c.target.stateId !== orig.target.stateId &&
            orig.targetRange
        ) {
            ops.push({ start: orig.targetRange.start, end: orig.targetRange.end, replacement: c.target.stateId });
        }
        // Condition edit-text: an editable option's `if` condition changed to new (non-empty) text -> splice
        // its `condRange` (the expression between `if (` and `)`). Wrap (add a condition to a flat option) and
        // unwrap (remove it) are Phase 3 - they add/remove the `if` wrapper, not just its condition token.
        if (
            orig.condRange &&
            orig.conditionEditable !== false &&
            c.condition !== undefined &&
            c.condition !== "" &&
            c.condition !== orig.condition
        ) {
            ops.push({ start: orig.condRange.start, end: orig.condRange.end, replacement: c.condition });
        }
    }
    return applySplices(originalText, ops);
}
