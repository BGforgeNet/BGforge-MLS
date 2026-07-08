/**
 * TD surgical source editor: splices field and structural edits back into the `.td` TypeScript SOURCE using the
 * byte ranges the TD source parser recorded (into the `.td`, not generated D). Mirrors `applyTSSLDialogEdits`
 * but over TD's WeiDU-D-family syntax (`function id() { say(tra(N)); reply(tra(M)); goTo(t); }`), so the edits
 * are surgical per-statement splices - never a lossy whole-function re-serialize, which would drop the comments
 * a TD function can carry. Currently: transition RETARGET (a `goTo(<id>)` whose target changed) and REMOVE
 * OPTION (a transition dropped from a surviving node -> its whole `reply(...); goTo(...);` group is spliced out).
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import { serializeTDTransition } from "./dialog-td-serialize";
import type { DialogChoice, DialogModel, DialogState } from "./dialog-model";

function choicesOf(model: DialogModel): DialogChoice[] {
    return model.roots.flatMap((r) => r.states).flatMap((s) => s.choices);
}

function allStates(model: DialogModel): DialogState[] {
    return model.roots.flatMap((r) => r.states);
}

/**
 * A pending-new option: no source span yet (`sourceRange` absent) and text already allocated to a bare `@N`
 * ref (allocation runs before this writer, in the weidu-d branch of computeDialogSourceEdit). Byte-identical in
 * spirit to the TSSL writer's `isNewTSSLOption`, keyed on the D-family source marker.
 */
function isNewTDOption(c: DialogChoice): boolean {
    return c.sourceRange === undefined && /^@\d+$/.test((c.text ?? "").trim());
}

/** The leading whitespace of the line containing `offset` - reused as the indent for an inserted statement. */
function lineIndentAt(text: string, offset: number): string {
    let start = offset;
    while (start > 0 && text[start - 1] !== "\n") start--;
    let i = start;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    return text.slice(start, i);
}

/** Splice a whole statement group out, eating its line's leading indent and trailing newline so no blank line
 *  is left where it was. Mirrors the TSSL writer's `removeLineSplice`. */
function removeLineSplice(text: string, span: { start: number; end: number }): SpliceOp {
    let start = span.start;
    while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
    let end = span.end;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\n") end += 1;
    return { start, end, replacement: "" };
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
    // Structural: an existing option removed from a SURVIVING node -> splice out its whole `reply(...); goTo(...);`
    // statement group (the choice's `sourceRange`). An option in a DELETED node goes with that node's function
    // splice (Phase 3 remove-node), so only surviving nodes are scanned here to keep the spans disjoint.
    const editedIds = new Set(choicesOf(edited).map((c) => c.id));
    const editedStateIds = new Set(allStates(edited).map((s) => s.id));
    for (const os of allStates(original)) {
        if (!editedStateIds.has(os.id)) continue;
        for (const orig of os.choices) {
            if (editedIds.has(orig.id) || !orig.sourceRange) continue;
            ops.push(removeLineSplice(originalText, orig.sourceRange));
        }
    }
    // Structural: a NEW option added to an existing node -> serialize its `reply(tra(N)); goTo(...);` group and
    // insert after the last SURVIVING option's statement (so it never lands inside a removed option's span). A
    // node with no surviving option (say-only) anchors just before its function's closing brace. Mirrors
    // `applyTSSLDialogEdits`' add-option case.
    const origStateById = new Map(allStates(original).map((s) => [s.id, s]));
    for (const state of allStates(edited)) {
        const origState = origStateById.get(state.id);
        if (!origState) continue; // a brand-new node is emitted whole by the add-node writer, not here
        const added = state.choices.filter((c) => isNewTDOption(c));
        if (added.length === 0) continue;
        const survivors = origState.choices
            .filter((o) => editedIds.has(o.id) && o.sourceRange)
            .map((o) => o.sourceRange!);
        let offset: number | undefined;
        let indent = "    ";
        if (survivors.length > 0) {
            const last = survivors.reduce((a, b) => (b.end > a.end ? b : a));
            offset = last.end;
            indent = lineIndentAt(originalText, last.start);
        } else if (origState.sourceRange) {
            // Say-only node: anchor just before the function's closing brace, at the body indent.
            const close = originalText.lastIndexOf("}", origState.sourceRange.end - 1);
            if (close > origState.sourceRange.start) {
                offset = close;
                let bodyStart = origState.sourceRange.start;
                while (bodyStart < close && originalText[bodyStart] !== "\n") bodyStart++;
                indent = lineIndentAt(originalText, bodyStart + 1) || indent;
            }
        }
        if (offset !== undefined) {
            const block = added.map((c) => `\n\n${serializeTDTransition(c, indent)}`).join("");
            ops.push({ start: offset, end: offset, replacement: block });
        }
    }
    return applySplices(originalText, ops);
}
