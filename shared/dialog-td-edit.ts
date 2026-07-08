/**
 * TD surgical source editor: splices field and structural edits back into the `.td` TypeScript SOURCE using the
 * byte ranges the TD source parser recorded (into the `.td`, not generated D). Mirrors `applyTSSLDialogEdits`
 * but over TD's WeiDU-D-family syntax (`function id() { say(tra(N)); reply(tra(M)); goTo(t); }`), so the edits
 * are surgical per-statement splices - never a lossy whole-function re-serialize, which would drop the comments
 * a TD function can carry. Supports: transition RETARGET (a `goTo(<id>)` whose target changed) and TERMINAL FLIP
 * (an inbound option redirected to exit); REMOVE/ADD OPTION (a `reply(...); goTo(...);` group spliced out or
 * inserted at the survivor anchor); and REMOVE/ADD/RENAME NODE (the `function` span plus its state-list wiring
 * in append/begin and its entry-block goTo references).
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import { serializeTDState, serializeTDTarget, serializeTDTransition } from "./dialog-td-serialize";
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

/** Splice a whole state function out, plus the blank line separating it from the next (up to two trailing
 *  newlines), so deleting a node leaves the surrounding functions cleanly spaced. */
function removeFunctionSplice(text: string, span: { start: number; end: number }): SpliceOp {
    let end = span.end;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\n") end += 1;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\n") end += 1;
    return { start: span.start, end, replacement: "" };
}

/**
 * Splice a state-list element out of an `append`/`begin` list, consuming one adjacent comma so the list stays
 * well-formed: a non-last element eats its FOLLOWING `, `, a last element eats its PRECEDING `, `.
 */
function removeListElement(text: string, range: { start: number; end: number }): SpliceOp {
    let e = range.end;
    while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
    if (text[e] === ",") {
        e++;
        while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
        return { start: range.start, end: e, replacement: "" };
    }
    let s = range.start;
    while (s > 0 && (text[s - 1] === " " || text[s - 1] === "\t")) s--;
    if (text[s - 1] === ",") s--;
    return { start: s, end: range.end, replacement: "" };
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
        // Terminal flip: an inbound option retargeted from a state to a terminal (exit/external) - typically its
        // target node was deleted and `deleteState` redirected it to exit - rewrites the `goTo(<id>)` call to
        // `exit()` (or `extern(...)`), keeping the `reply(...)`. Uses the isolable target-call span (statement
        // form only); mutually exclusive with the state->state retarget above.
        if (orig.target.kind === "state" && c.target.kind !== "state" && orig.targetCallRange) {
            ops.push({
                start: orig.targetCallRange.start,
                end: orig.targetCallRange.end,
                replacement: serializeTDTarget(c.target),
            });
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
    // Structural: RENAME node - a state whose id changed carries `renamedFrom` (set by renameState). Rewrite its
    // function-name token and every OUT-OF-BODY reference to the old id (append/begin list element, entry-block
    // goTo target). Inbound OPTION targets inside state functions were moved by the model retarget (handled by
    // the retarget splice above), so they are NOT touched here - the double-splice guard, mirroring
    // applyTSSLDialogEdits. A renamed-away old id is also excluded from the DELETE loop below (absent from
    // editedStateIds, but not a deletion).
    const renamedFromIds = new Set<string>();
    for (const state of allStates(edited)) {
        if (!state.renamedFrom || !state.nameRange) continue;
        renamedFromIds.add(state.renamedFrom);
        ops.push({ start: state.nameRange.start, end: state.nameRange.end, replacement: state.id });
        for (const ref of original.tdWiring?.refs ?? []) {
            if (ref.name === state.renamedFrom) {
                ops.push({ start: ref.range.start, end: ref.range.end, replacement: state.id });
            }
        }
    }
    // Structural: DELETE node - an original node absent from the edited model -> splice out its whole function
    // (plus the separating blank line), prune its state-list membership, and redirect any entry-block goTo to
    // exit() so no reference dangles. Disjoint from every option splice (functions do not overlap, and an inbound
    // option that flipped to a terminal lives in a DIFFERENT surviving node's body).
    const deletedIds = new Set<string>();
    for (const os of allStates(original)) {
        if (editedStateIds.has(os.id) || renamedFromIds.has(os.id) || os.derivedFrom || !os.sourceRange) continue;
        deletedIds.add(os.id);
        ops.push(removeFunctionSplice(originalText, os.sourceRange));
    }
    for (const ref of original.tdWiring?.refs ?? []) {
        if (!deletedIds.has(ref.name)) continue;
        if (ref.kind === "list") ops.push(removeListElement(originalText, ref.range));
        else if (ref.callRange) {
            // Entry-block goTo target: redirect to exit() rather than leave a jump to a removed state.
            ops.push({ start: ref.callRange.start, end: ref.callRange.end, replacement: "exit()" });
        }
    }
    // Structural: ADD node - a locally-new state (no sourceRange, not derived/committed) -> serialize a whole
    // `function <id>() { ... }` before the primary wiring statement and append its id to that state list. All new
    // functions coalesce into one insert at the anchor (and one id-list insert) so their order is deterministic
    // and no two zero-width ops contend for the same offset. A file with no append/begin list (no anchor) cannot
    // wire a new node, so it is left unserialized - a from-scratch scaffold is out of scope for this writer.
    const wiring = original.tdWiring;
    const newStates = allStates(edited).filter((s) => s.sourceRange === undefined && !s.derivedFrom && !s.committed);
    if (newStates.length > 0 && wiring?.newFnAnchor !== undefined) {
        const fns = newStates.map((s) => `${serializeTDState(s)}\n\n`).join("");
        ops.push({ start: wiring.newFnAnchor, end: wiring.newFnAnchor, replacement: fns });
        if (wiring.listInsert) {
            const ids = newStates.map((s) => s.id).join(", ");
            ops.push({
                start: wiring.listInsert.offset,
                end: wiring.listInsert.offset,
                replacement: `${wiring.listInsert.separator}${ids}`,
            });
        }
    }
    return applySplices(originalText, ops);
}
