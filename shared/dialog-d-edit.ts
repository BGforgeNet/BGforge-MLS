/**
 * Surgical in-place editor for WeiDU D source text.
 *
 * Applies a dialog editor's changes back to the original .d source by splicing
 * only the changed state blocks, leaving all other bytes byte-for-byte identical:
 * comments, ALTER_TRANS/REPLACE patch blocks, CHAIN syntax, untouched states,
 * and surrounding whitespace are all preserved.
 *
 * The key insight is that modelToD (dialog-d-serialize.ts) is LOSSY - it drops
 * patch blocks, comments, and CHAIN structure. So full regeneration is not safe.
 * Instead: each state's source range (set by the parser via DDialogState.range ->
 * DialogState.sourceRange) identifies exactly which bytes to replace. We replace
 * only those bytes with the re-serialized form of the edited state.
 *
 * Newly-added states (no sourceRange, not derived) are inserted after the last existing
 * state of their root (or appended to the file if the root has none in the source).
 * Derived states (CHAIN/INTERJECT/EXTEND links, also without a sourceRange) are skipped
 * entirely - their bytes live inside a preserved construct, so re-emitting would duplicate.
 */

import type { DialogChoice, DialogModel, DialogState, DialogTarget } from "./dialog-model";
import { serializeChoice, serializeState, serializeTextValue } from "./dialog-d-serialize";
import { applySplices, type SpliceOp, type VerifyResult } from "./dialog-splice";

function targetsEqual(a: DialogTarget, b: DialogTarget): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "state" && b.kind === "state") return a.stateId === b.stateId;
    if (a.kind === "external" && b.kind === "external") return a.label === b.label;
    return true; // exit
}

/**
 * True when two states are identical in every field that affects serialization
 * (id, text, trigger, weight, and each choice's text/condition/action/target).
 * An unchanged state is left byte-for-byte in the source rather than re-serialized
 * from the lossy model - re-serializing would reflow `@N` refs, `++` shorthand,
 * comments, and whitespace the model does not carry. `sourceRange`/`derivedFrom`
 * are intentionally excluded: they are not authored content.
 */
function choiceEqual(a: DialogChoice, b: DialogChoice): boolean {
    return (
        (a.text ?? null) === (b.text ?? null) &&
        (a.condition ?? "") === (b.condition ?? "") &&
        (a.action ?? null) === (b.action ?? null) &&
        targetsEqual(a.target, b.target)
    );
}

function choicesEqual(a: readonly DialogChoice[], b: readonly DialogChoice[]): boolean {
    return a.length === b.length && a.every((ca, i) => choiceEqual(ca, b[i]!));
}

function stateUnchanged(a: DialogState, b: DialogState): boolean {
    return (
        a.id === b.id &&
        a.text === b.text &&
        (a.trigger ?? "") === (b.trigger ?? "") &&
        (a.weight ?? null) === (b.weight ?? null) &&
        choicesEqual(a.choices, b.choices)
    );
}

/**
 * Try to express a changed state as per-field `TextEdit`s - splicing only the changed
 * field's byte span, leaving the rest of the state (shorthand, comments, indentation,
 * untouched fields) byte-identical. Returns null when the change cannot be confined to a
 * field with a known range, in which case the caller re-serializes the whole state.
 *
 * Handles a SAY-only edit (the NPC line changed and nothing else). Trigger and
 * per-transition edits are added in later steps; structural changes (transition
 * add/remove/reorder) intentionally return null and fall back to whole-state.
 */
function fieldEditOps(original: DialogState, edited: DialogState): SpliceOp[] | null {
    // Header changes have no dedicated field span (the id and WEIGHT live inline in the
    // `IF [WEIGHT #n] ~trigger~ THEN BEGIN <id>` header), and an add/remove/count change to
    // the transition list is structural - all fall back to a whole-state re-serialize.
    if (original.id !== edited.id) return null;
    if ((original.weight ?? null) !== (edited.weight ?? null)) return null;
    if (original.choices.length !== edited.choices.length) return null;

    const ops: SpliceOp[] = [];
    if (original.text !== edited.text) {
        if (!original.sayRange) return null;
        ops.push({
            start: original.sayRange.start,
            end: original.sayRange.end,
            replacement: serializeTextValue(edited.text),
        });
    }
    if ((original.trigger ?? "") !== (edited.trigger ?? "")) {
        if (!original.triggerRange) return null;
        // The trigger node spans its `~ ~` delimiters; re-emit the whole `~trigger~`.
        ops.push({
            start: original.triggerRange.start,
            end: original.triggerRange.end,
            replacement: `~${edited.trigger ?? ""}~`,
        });
    }
    // Splice each changed transition over its own span. With equal counts this also covers
    // a positional reorder, since each position's span receives that position's choice.
    for (let i = 0; i < original.choices.length; i++) {
        const oc = original.choices[i]!;
        const ec = edited.choices[i]!;
        if (choiceEqual(oc, ec)) continue;
        if (!oc.sourceRange) return null;
        ops.push({ start: oc.sourceRange.start, end: oc.sourceRange.end, replacement: serializeChoice(ec) });
    }
    return ops.length > 0 ? ops : null;
}

/**
 * Apply all edits from `editedModel` back into `originalText`.
 *
 * States that carry a `sourceRange` are spliced in place; states without one are
 * inserted after the last ranged state of their root (`pendingInserts()` reports them).
 *
 * - An edited state that DIFFERS from its original (matched by `sourceRange`) ->
 *   its source span is replaced with the re-serialized block for that state.
 * - An edited state UNCHANGED from its original -> left byte-for-byte (no splice).
 *   This is the locality guarantee: a one-field edit to one state never reflows
 *   any other state's `@N` refs, shorthand, comments, or whitespace.
 * - An original-range span that is ABSENT from `editedModel` -> its source span
 *   is replaced with an empty string (deletion). Detecting both the unchanged and
 *   deleted cases needs the original states, so the caller supplies `originalModel`:
 *   the parse of `originalText` BEFORE the webview's edits. If omitted, every edited
 *   ranged state is re-serialized and no deletion is applied (conservative legacy
 *   behavior - correct, but it reformats untouched states).
 *
 * Splices are applied from the highest byte offset to the lowest so that earlier
 * offsets remain valid while later ones are being substituted.
 *
 * @throws if `editedModel.format !== "weidu-d"`.
 */
export function applyDialogEdits(originalText: string, editedModel: DialogModel, originalModel?: DialogModel): string {
    if (editedModel.format !== "weidu-d") {
        throw new Error("applyDialogEdits: only weidu-d models are supported");
    }

    // Collect all states across all roots in the edited model.
    const allEditedStates: DialogState[] = editedModel.roots.flatMap((r) => r.states);

    // Index the original states by source-range key, so each edited state can be
    // compared against the exact bytes it came from (unchanged -> skip) and so
    // deletions (original keys absent from the edit) can be detected.
    const originalStates = (originalModel?.roots.flatMap((r) => r.states) ?? []).filter((s) => s.sourceRange);
    const originalByKey = new Map<string, DialogState>();
    for (const s of originalStates) {
        originalByKey.set(`${s.sourceRange!.start}:${s.sourceRange!.end}`, s);
    }

    // Build a set of source range keys present in the edited model
    // (keyed as "start:end" for O(1) lookup).
    const survivingRangeKeys = new Set<string>();
    for (const state of allEditedStates) {
        if (state.sourceRange) {
            survivingRangeKeys.add(`${state.sourceRange.start}:${state.sourceRange.end}`);
        }
    }

    const ops: SpliceOp[] = [];
    const seenRangeKeys = new Set<string>();

    // Build splice ops only for edited states that ACTUALLY CHANGED. An unchanged
    // state is left untouched so its original bytes survive verbatim.
    for (const state of allEditedStates) {
        if (!state.sourceRange) {
            // No source range -> newly added state, deferred to v2.
            continue;
        }
        const key = `${state.sourceRange.start}:${state.sourceRange.end}`;
        if (seenRangeKeys.has(key)) {
            // Two edited states referencing the same source range; take the first.
            // A well-formed model should not produce this.
            continue;
        }
        seenRangeKeys.add(key);

        const original = originalByKey.get(key);
        if (original && stateUnchanged(original, state)) {
            // Identical to its source - leave the original bytes in place.
            continue;
        }

        // Prefer a per-field splice (changes only the edited field's span, preserving the
        // rest of the state verbatim); fall back to a whole-state re-serialize otherwise.
        const fieldOps = original ? fieldEditOps(original, state) : null;
        if (fieldOps) {
            ops.push(...fieldOps);
            continue;
        }

        const replacement = serializeState(state).join("\n");
        ops.push({
            start: state.sourceRange.start,
            end: state.sourceRange.end,
            replacement,
        });
    }

    // Build splice ops for deleted states (original ranges absent from the edited model).
    for (const range of originalStates) {
        const key = `${range.sourceRange!.start}:${range.sourceRange!.end}`;
        if (!survivingRangeKeys.has(key)) {
            // This original range is gone from the edited model -> delete it.
            // Guard against duplicate entries.
            if (!seenRangeKeys.has(key)) {
                seenRangeKeys.add(key);
                ops.push({ start: range.sourceRange!.start, end: range.sourceRange!.end, replacement: "" });
            }
        }
    }

    // Insert newly-added states (no sourceRange) right after the last existing
    // (ranged) state of their root, so a new state lands among its siblings. If the
    // root has no ranged state to anchor to, append at the end of the file. This is
    // a zero-width op (start === end), so it composes with the replacements above.
    for (const root of editedModel.roots) {
        // A derived state (CHAIN/INTERJECT/EXTEND link) also lacks a sourceRange, but it is
        // NOT a new state - its bytes live inside the construct that produced it, which is
        // preserved untouched. Re-emitting it here would duplicate it as a standalone block.
        const fresh = root.states.filter((s) => !s.sourceRange && !s.derivedFrom);
        if (fresh.length === 0) continue;
        let anchor = -1;
        for (const s of root.states) {
            if (s.sourceRange) anchor = Math.max(anchor, s.sourceRange.end);
        }
        const at = anchor >= 0 ? anchor : originalText.length;
        // Bootstrap: a from-scratch .d file (no dialog block anywhere - the graph's `+ State` minted the first
        // state) has nowhere for the new states to live. When appending at EOF AND the source declares no
        // dialog block (no top-level BEGIN), wrap them in a `BEGIN ~resref~` so they form a valid dialog file
        // rather than orphan state blocks. The resref is the dialog file name (sourceName), the WeiDU convention.
        const needsBlock = anchor < 0 && !/^[ \t]*BEGIN\b/m.test(originalText);
        if (needsBlock) {
            const resref = editedModel.sourceName || root.label || "new_dialog";
            const lead = originalText.length === 0 || originalText.endsWith("\n") ? "" : "\n";
            const states = fresh.map((s) => serializeState(s).join("\n")).join("\n\n");
            ops.push({ start: at, end: at, replacement: `${lead}BEGIN ~${resref}~\n\n${states}\n` });
        } else {
            const block = fresh.map((s) => "\n" + serializeState(s).join("\n")).join("");
            ops.push({ start: at, end: at, replacement: block });
        }
    }

    // Apply splice ops via the shared core (sorts highest-offset-first so earlier
    // offsets remain valid as the string is modified from the end toward the front).
    return applySplices(originalText, ops);
}

/**
 * Returns states in `editedModel` that have no `sourceRange` (newly created in the
 * editor). `applyDialogEdits` inserts these after the last existing state of their
 * root; this accessor lets a caller report what was added.
 */
export function pendingInserts(editedModel: DialogModel): DialogState[] {
    // Exclude derived states (CHAIN/INTERJECT/EXTEND): they have no sourceRange but are not
    // new - they belong to a preserved construct and must never be re-emitted as inserts.
    return editedModel.roots.flatMap((r) => r.states).filter((s) => !s.sourceRange && !s.derivedFrom);
}

function dialogStatesOf(model: DialogModel): DialogState[] {
    return model.roots.filter((r) => r.kind === "dialog").flatMap((r) => r.states);
}

/**
 * Confirm a save landed as intended: every editable state of `intended` (the model the
 * editor wrote) reappears, faithfully, in `actual` (the re-parse of the saved file). A
 * divergence means the serializer produced text that does NOT round-trip back to the
 * edit - a regression to surface rather than accept silently. This is the self-checking
 * minimal-diff guard: it runs over two models (no re-parse needed in-process, since the
 * server already re-parsed the saved document), so the client can compare what it sent
 * against what came back.
 *
 * Derived (CHAIN/INTERJECT/EXTEND) states are skipped - they are read-only and regenerate
 * from their preserved source construct. Non-weidu-d models are view-only (never written),
 * so they always verify.
 */
export function verifyDialogEditApplied(intended: DialogModel, actual: DialogModel): VerifyResult {
    if (intended.format !== "weidu-d") return { ok: true };
    const actualById = new Map(dialogStatesOf(actual).map((s) => [s.id, s]));
    for (const s of dialogStatesOf(intended)) {
        if (s.derivedFrom) continue;
        const a = actualById.get(s.id);
        if (!a) return { ok: false, reason: `state "${s.id}" is missing from the saved file` };
        if (!stateUnchanged(s, a)) return { ok: false, reason: `state "${s.id}" differs from the intended edit` };
    }
    return { ok: true };
}
