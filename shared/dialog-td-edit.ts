/**
 * TD surgical source editor: splices field edits back into the `.td` TypeScript SOURCE using the byte ranges
 * the TD source parser recorded (into the `.td`, not generated D). Field edits only; structural add/remove is
 * Phase 3. Currently: option/transition RETARGET (a `goTo(<id>)` whose target changed splices its target token).
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import type { DialogChoice, DialogModel } from "./dialog-model";

function choicesOf(model: DialogModel): DialogChoice[] {
    return model.roots.flatMap((r) => r.states).flatMap((s) => s.choices);
}

/**
 * Compute the `.td` source with the model's surgical field edits applied. Returns the text unchanged when
 * nothing surgical changed.
 *
 * @throws if `edited.sourceLang !== "td"` - a D/SSL/TSSL model must not be serialized as TD.
 */
export function applyTDDialogEdits(originalText: string, edited: DialogModel, original: DialogModel): string {
    if (edited.sourceLang !== "td") {
        throw new Error("applyTDDialogEdits: only td source models are supported");
    }
    const origById = new Map(choicesOf(original).map((c) => [c.id, c]));
    const ops: SpliceOp[] = [];
    for (const c of choicesOf(edited)) {
        const orig = origById.get(c.id);
        if (!orig) continue;
        // Retarget: a transition's target state (a `goTo(<id>)`) changed and the parser recorded the id span.
        if (
            c.target.kind === "state" &&
            orig.target.kind === "state" &&
            c.target.stateId !== orig.target.stateId &&
            orig.targetRange
        ) {
            ops.push({ start: orig.targetRange.start, end: orig.targetRange.end, replacement: c.target.stateId });
        }
    }
    return applySplices(originalText, ops);
}
