/**
 * TSSL surgical source editor: splices field edits back into the `.tssl` TypeScript SOURCE using the byte
 * ranges the source parser recorded (ranges into the .tssl, not generated SSL). Mirrors `applySSLDialogEdits`
 * but over TS syntax; because a TSSL option call is byte-identical to SSL (`NOption(101, Node002, 4)`), the
 * per-field token splices (retarget, ...) are the same - only the node wrapper and block syntax differ, which
 * field edits do not touch. Structural edits: remove-option and add-option land here (add reuses the SSL option
 * serializer, the syntax being identical); add/remove/rename NODE is handled alongside as it lands.
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import { serializeSSLOption } from "./dialog-ssl-serialize";
import type { DialogChoice, DialogModel, DialogState } from "./dialog-model";

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
    // Structural: an existing option removed from the edited model -> splice its statement out. A pure
    // conditional option is the sole content of its `if`, so remove the whole `if`; otherwise just the call.
    const editedIds = new Set(statesOf(edited).map((c) => c.id));
    for (const orig of statesOf(original)) {
        if (editedIds.has(orig.id)) continue;
        // A pure conditional option (conditionEditable => its `if` gates it alone) removes the whole `if`;
        // an unconditional or shared-condition option removes just its own call statement.
        const removeSpan = orig.ifRange && orig.conditionEditable !== false ? orig.ifRange : orig.stmtRange;
        if (removeSpan) ops.push(removeLineSplice(originalText, removeSpan));
    }
    // Structural: a NEW option added to an existing node -> serialize it (reusing the SSL option serializer,
    // since the call syntax is byte-identical) and insert after the last SURVIVING option's statement so it
    // never lands inside a removed option's span. A reply-only node with no surviving option anchors just
    // before its closing brace. Mirrors `applySSLDialogEdits`' ADD case.
    const origStateById = new Map(allStates(original).map((s) => [s.id, s]));
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
    return applySplices(originalText, ops);
}
