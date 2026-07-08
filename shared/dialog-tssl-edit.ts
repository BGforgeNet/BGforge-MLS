/**
 * TSSL surgical source editor: splices field edits back into the `.tssl` TypeScript SOURCE using the byte
 * ranges the source parser recorded (ranges into the .tssl, not generated SSL). Mirrors `applySSLDialogEdits`
 * but over TS syntax; because a TSSL option call is byte-identical to SSL (`NOption(101, Node002, 4)`), the
 * per-field token splices (retarget, ...) are the same - only the node wrapper and block syntax differ, which
 * field edits do not touch. Structural edits: remove-option and add-option land here (add reuses the SSL option
 * serializer, the syntax being identical); add/remove/rename NODE is handled alongside as it lands.
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import { isLocalNewSSLNode, survivorReplacement } from "./dialog-ssl-edit";
import { serializeSSLOption } from "./dialog-ssl-serialize";
import { serializeTSSLProcedure } from "./dialog-tssl-serialize";
import type { DialogChoice, DialogModel, DialogState } from "./dialog-model";

/** The TSSL entry router (a bare-call dispatcher), mirroring SSL's `talk_p_proc`. New nodes anchor before it. */
const TALK_PROC = "talk_p_proc";

function statesOf(model: DialogModel): DialogChoice[] {
    // Flatten every choice across roots/states for id-keyed diffing.
    return model.roots.flatMap((r) => r.states).flatMap((s) => s.choices);
}

function allStates(model: DialogModel): DialogState[] {
    return model.roots.flatMap((r) => r.states);
}

/**
 * A pending-new option: no source span yet (`callRange`/`stmtRange` absent), already carries an allocated
 * `@N` id (allocation runs before this writer, gated on renderFamily fallout-ssl - TSSL inherits it), and not
 * `committed` (already spliced on a prior save). Byte-identical predicate to SSL's `isNewSSLOption`.
 */
function isNewTSSLOption(c: DialogChoice): boolean {
    return (
        !c.committed && c.callRange === undefined && c.stmtRange === undefined && /^@\d+$/.test((c.text ?? "").trim())
    );
}

/** The numeric `.msg` id from an `@N` display text, or NaN. The serialized option references ids by number. */
function msgIdOf(c: DialogChoice): number {
    const m = /^@(\d+)$/.exec((c.text ?? "").trim());
    return m ? Number(m[1]) : NaN;
}

/** The leading whitespace of the line containing `offset` - reused as the indent for an inserted statement. */
function lineIndentAt(text: string, offset: number): string {
    let start = offset;
    while (start > 0 && text[start - 1] !== "\n") start--;
    let i = start;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    return text.slice(start, i);
}

/** Splice a whole statement out, eating its line's leading indent and trailing newline so no blank line remains. */
function removeLineSplice(text: string, span: { start: number; end: number }): SpliceOp {
    let start = span.start;
    while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
    let end = span.end;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\n") end += 1;
    return { start, end, replacement: "" };
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

    // REORDER (per node): when a node's surviving flat options appear in a different order than source, refill
    // each source callRange slot with the option now at that position (survivor refill, mirroring SSL's nodeOps).
    // Field edits (target/reaction/low) are subsumed via `survivorReplacement`, so a reordered option's own
    // per-choice field splice below is suppressed (`reorderedIds`) to avoid double-splicing its callRange. Only
    // FLAT options participate: a conditional option's callRange sits inside an `if` wrapper that does not move
    // with the call, so it is pinned to its own slot - matching SSL. Slot refills are disjoint from add (a
    // zero-width insert at the survivor anchor) and remove (a whole-statement splice of a NON-survivor option),
    // so this composes with a concurrent structural edit.
    const origStateById = new Map(allStates(original).map((s) => [s.id, s]));
    const reorderedIds = new Set<string>();
    for (const state of allStates(edited)) {
        const origState = origStateById.get(state.renamedFrom ?? state.id);
        if (!origState) continue;
        const editedIdSet = new Set(state.choices.map((ch) => ch.id));
        const isFlatOrig = (o: DialogChoice): boolean => o.callRange !== undefined && o.condition === undefined;
        const flatOrigSurvivors = origState.choices.filter((o) => isFlatOrig(o) && editedIdSet.has(o.id));
        const flatEditedSurvivors = state.choices.filter((ch) => {
            const o = origById.get(ch.id);
            return o !== undefined && isFlatOrig(o);
        });
        const sourceOrder = flatOrigSurvivors.map((o) => o.id).join("|");
        const editedOrder = flatEditedSurvivors.map((ch) => ch.id).join("|");
        if (sourceOrder === editedOrder) continue; // no reorder - the per-choice field splices below apply
        for (let i = 0; i < flatOrigSurvivors.length; i++) {
            const slot = flatOrigSurvivors[i]!.callRange!;
            const moved = flatEditedSurvivors[i]!;
            const movedOrig = origById.get(moved.id)!;
            reorderedIds.add(moved.id);
            const replacement = survivorReplacement(originalText, moved, movedOrig);
            if (replacement !== originalText.slice(slot.start, slot.end)) {
                ops.push({ start: slot.start, end: slot.end, replacement });
            }
        }
    }

    for (const c of statesOf(edited)) {
        const orig = origById.get(c.id);
        if (!orig) continue;
        // In-place field edits on a surviving state-target option (retarget + reaction N/G/B + low-INT variant):
        // rewrite the option call in its `callRange` slot, sharing `survivorReplacement` with the SSL writer
        // since a TSSL option call is byte-identical to SSL's. A retarget-only edit token-patches the target; a
        // reaction change token-patches just the macro-name (`NOption` -> `GOption`), leaving the other args
        // byte-exact; a low-INT toggle re-serializes the whole call (the Low/non-Low forms differ in arg count,
        // `NOption(id, node, skill)` <-> `NLowOption(id, node)`), preserving the original numeric id text.
        if (
            !reorderedIds.has(c.id) &&
            c.target.kind === "state" &&
            orig.target.kind === "state" &&
            orig.callRange &&
            orig.targetRange
        ) {
            const replacement = survivorReplacement(originalText, c, orig);
            if (replacement !== originalText.slice(orig.callRange.start, orig.callRange.end)) {
                ops.push({ start: orig.callRange.start, end: orig.callRange.end, replacement });
            }
        }
        // Terminal flip: an option retargeted from a state to exit/terminal - e.g. its target node was deleted
        // and `ops.deleteState` redirected the inbound option to exit - is rewritten from `NOption(id, Node, sk)`
        // to the terminal `NMessage(id)` (reusing the SSL serializer, whose non-state branch emits NMessage).
        // Replaces the whole statement span; mutually exclusive with the state->state retarget above.
        if (
            orig.target.kind === "state" &&
            c.target.kind !== "state" &&
            orig.stmtRange &&
            Number.isFinite(msgIdOf(c))
        ) {
            ops.push({
                start: orig.stmtRange.start,
                end: orig.stmtRange.end,
                replacement: serializeSSLOption(c, msgIdOf(c)),
            });
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
    // Structural: an existing option removed from a SURVIVING node -> splice its statement out. (An option
    // in a DELETED node is removed by that node's whole-function splice below; removing it individually too
    // would overlap.) A pure conditional option is the sole content of its `if`, so remove the whole `if`;
    // otherwise just the call.
    // RENAME node: a node whose id changed carries `renamedFrom` (set by ops.renameState). Rewrite its
    // function-name token and every entry call / out-of-band call targeting the OLD id. Inbound OPTION targets
    // were moved by the model's retarget (handled by the state->state retarget splice above), so they are not
    // touched here - the double-splice guard, mirroring applySSLDialogEdits. The old id is also excluded from
    // the DELETE loop below (a renamed-away id is absent from editedStateIds but is NOT a deletion).
    const renamedFromIds = new Set<string>();
    for (const state of allStates(edited)) {
        if (!state.renamedFrom || !state.nameRange) continue;
        renamedFromIds.add(state.renamedFrom);
        ops.push({ start: state.nameRange.start, end: state.nameRange.end, replacement: state.id });
        for (const ec of original.entryCalls ?? []) {
            if (ec.name === state.renamedFrom) {
                ops.push({ start: ec.targetRange.start, end: ec.targetRange.end, replacement: state.id });
            }
        }
        for (const ob of original.outOfBandCalls ?? []) {
            if (ob.name === state.renamedFrom) {
                ops.push({ start: ob.targetRange.start, end: ob.targetRange.end, replacement: state.id });
            }
        }
    }
    const editedIds = new Set(statesOf(edited).map((c) => c.id));
    const editedStateIds = new Set(allStates(edited).map((s) => s.id));
    for (const os of allStates(original)) {
        if (!editedStateIds.has(os.id)) continue; // deleted node - its options go with the procRange splice below
        for (const orig of os.choices) {
            if (editedIds.has(orig.id)) continue;
            // A pure conditional option (conditionEditable => its `if` gates it alone) removes the whole `if`;
            // an unconditional or shared-condition option removes just its own call statement.
            const removeSpan = orig.ifRange && orig.conditionEditable !== false ? orig.ifRange : orig.stmtRange;
            if (removeSpan) ops.push(removeLineSplice(originalText, removeSpan));
        }
    }
    // Structural: DELETE node - an original node absent from the edited model -> splice out its whole function
    // span plus the trailing newline it would leave. Disjoint from every option splice (functions do not
    // overlap, and an inbound option that flipped to a terminal lives in a DIFFERENT surviving node). Mirrors
    // `applySSLDialogEdits`' DELETE case; renamed-away nodes are excluded once rename lands (Phase 3 task 3).
    for (const os of allStates(original)) {
        if (editedStateIds.has(os.id) || renamedFromIds.has(os.id) || !os.procRange) continue;
        const start = os.procRange.start;
        const nl = originalText.indexOf("\n", os.procRange.end);
        const end = nl === -1 ? os.procRange.end : nl + 1;
        ops.push({ start, end, replacement: "" });
    }
    // Entry-call cleanup: when a node is deleted, remove its `NodeNNN();` entry call from talk_p_proc so no
    // dangling reference remains. Only top-level entry calls are spliced (a call nested in an `if` cannot be
    // removed without rewriting the conditional). A renamed node keeps its entry call (rewritten above).
    for (const ec of original.entryCalls ?? []) {
        if (editedStateIds.has(ec.name) || renamedFromIds.has(ec.name) || !ec.topLevel) continue;
        ops.push(removeLineSplice(originalText, ec.stmtRange));
    }
    // Structural: a NEW option added to an existing node -> serialize it (reusing the SSL option serializer,
    // since the call syntax is byte-identical) and insert after the last SURVIVING option's statement so it
    // never lands inside a removed option's span. A reply-only node with no surviving option anchors just
    // before its closing brace. Mirrors `applySSLDialogEdits`' ADD case.
    for (const state of allStates(edited)) {
        const origState = origStateById.get(state.id);
        if (!origState) continue; // a brand-new node is emitted whole by the add-node writer, not here
        const added = state.choices.filter((c) => isNewTSSLOption(c) && Number.isFinite(msgIdOf(c)));
        if (added.length === 0) continue;
        const survivorEnds = origState.choices
            .filter((o) => editedIds.has(o.id) && o.stmtRange)
            .map((o) => o.stmtRange!);
        let offset: number | undefined;
        let indent = "    ";
        if (survivorEnds.length > 0) {
            const last = survivorEnds.reduce((a, b) => (b.end > a.end ? b : a));
            offset = last.end;
            indent = lineIndentAt(originalText, last.start);
        } else if (origState.procRange) {
            // Reply-only node: anchor just before the function's closing brace, matching the body indent.
            const close = originalText.lastIndexOf("}", origState.procRange.end - 1);
            if (close > origState.procRange.start) {
                offset = close;
                let bodyStart = origState.procRange.start;
                while (bodyStart < close && originalText[bodyStart] !== "\n") bodyStart++;
                indent = lineIndentAt(originalText, bodyStart + 1) || indent;
            }
        }
        if (offset !== undefined) {
            const block = added.map((c) => `\n${indent}${serializeSSLOption(c, msgIdOf(c))}`).join("");
            ops.push({ start: offset, end: offset, replacement: block });
        }
    }
    // Structural: ADD node - a locally-new node (no procRange, not derived/renamed) -> serialize a whole
    // `function <id>() { ... }` and insert it just before the `talk_p_proc` entry router, mirroring
    // `applySSLDialogEdits`' add-node (which anchors before talk_p_proc). @N ids are already allocated
    // upstream (renderFamily=fallout-ssl gate). A file with no entry router is a from-scratch scaffold, out
    // of scope here. Disjoint from every option/node splice (the anchor is a zero-width insert at talk_p_proc).
    const talkAnchor = originalText.indexOf(`function ${TALK_PROC}`);
    if (talkAnchor !== -1) {
        for (const state of allStates(edited)) {
            if (!isLocalNewSSLNode(state) || state.committed) continue;
            ops.push({ start: talkAnchor, end: talkAnchor, replacement: `${serializeTSSLProcedure(state)}\n\n` });
        }
    }
    return applySplices(originalText, ops);
}
