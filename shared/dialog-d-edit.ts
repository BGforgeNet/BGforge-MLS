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
import { serializeChoice, serializeSayValue, serializeState } from "./dialog-d-serialize";
import { applySplices, type SpliceOp } from "./dialog-splice";

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
        // A multisay continuation edit changes only sayTexts[1..] (line 0 == text unchanged); without this the
        // state reads as unchanged and the edit is skipped before it can splice (silently dropped).
        sameSayTexts(a.sayTexts, b.sayTexts) &&
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
/** Whether two multisay `sayTexts` arrays hold the same alternates (both absent counts as equal). */
function sameSayTexts(a?: string[], b?: string[]): boolean {
    if (!a || !b) return !a && !b;
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function fieldEditOps(original: DialogState, edited: DialogState): SpliceOp[] | null {
    // Header changes have no dedicated field span (the id and WEIGHT live inline in the
    // `IF [WEIGHT #n] ~trigger~ THEN BEGIN <id>` header), and an add/remove/count change to
    // the transition list is structural - all fall back to a whole-state re-serialize.
    if (original.id !== edited.id) return null;
    if ((original.weight ?? null) !== (edited.weight ?? null)) return null;
    if (original.choices.length !== edited.choices.length) return null;

    const ops: SpliceOp[] = [];
    // The SAY value changed when line 0 (`text`) OR any multisay continuation line (`sayTexts[1..]`) changed.
    // Keying only on `text` misses a continuation-only edit (line 0 unchanged), silently dropping it. An @N
    // continuation edit leaves its raw ref in sayTexts unchanged (the .tra entry changes, flushed separately),
    // so this correctly re-splices only a LITERAL continuation change; an @N one needs no source edit.
    if (original.text !== edited.text || !sameSayTexts(original.sayTexts, edited.sayTexts)) {
        if (!original.sayRange) return null;
        // `sayRange` covers the whole `text = text = text` value, so the replacement must re-emit every
        // alternate - not just `edited.text` - or a multisay state loses its other lines here (see serializeSayValue).
        ops.push({
            start: original.sayRange.start,
            end: original.sayRange.end,
            replacement: serializeSayValue(edited),
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
        // A state->state retarget with everything else equal splices ONLY the target label token
        // (the parser records its span for goto_next/short_goto), so the user's chosen transition
        // form - verbose `IF ... THEN REPLY ... GOTO x` or shorthand `++ ... + x` - survives
        // byte-for-byte. Re-serializing the transition would canonicalize it to shorthand.
        if (
            (oc.text ?? null) === (ec.text ?? null) &&
            (oc.condition ?? "") === (ec.condition ?? "") &&
            (oc.action ?? null) === (ec.action ?? null) &&
            oc.target.kind === "state" &&
            ec.target.kind === "state" &&
            oc.targetRange
        ) {
            ops.push({ start: oc.targetRange.start, end: oc.targetRange.end, replacement: ec.target.stateId });
            continue;
        }
        if (!oc.sourceRange) return null;
        ops.push({ start: oc.sourceRange.start, end: oc.sourceRange.end, replacement: serializeChoice(ec) });
    }
    return ops.length > 0 ? ops : null;
}

/**
 * A whole-state re-serialize spliced IN PLACE over the state's source span. The span starts at the
 * `IF` token - AFTER the header line's existing indentation, which stays in the document - so the
 * replacement's first line must carry no indent of its own: `serializeState`'s fixed two-space header
 * indent would otherwise be ADDED to the surviving original indent, shifting the header two columns
 * right on every successive re-serialize of the same state (the cumulative-creep defect the
 * round-trip harness surfaced).
 */
function serializeStateInPlace(state: DialogState): string {
    return serializeState(state)
        .join("\n")
        .replace(/^[ \t]+/, "");
}

/**
 * The view of a state this writer serializes and compares: a PENDING option with EMPTY reply text is
 * excluded. Such an option exists only in the webview until its text commits - splicing it would write a
 * `++ ~~ EXIT` husk the author never typed (and an abandoned add would leave it behind), and once spliced
 * its later text commit reads as an existing-literal edit instead of minting the `@N` a tra-managed dialog
 * expects. The SSL-family writers already defer exactly this way (isAllocatedNewOption requires an
 * allocated `@N`); the webview carries the deferred option across adopts (see DialogGraph's adoptModel).
 * A pending BARE transition (text undefined) is real content - a target - and still splices.
 */
function spliceableView(state: DialogState): DialogState {
    const choices = state.choices.filter(
        (c) => !(c.sourceRange === undefined && c.text !== undefined && c.text.trim() === ""),
    );
    return choices.length === state.choices.length ? state : { ...state, choices };
}

/**
 * Apply all edits from `editedModel` back into `originalText`.
 *
 * States that carry a `sourceRange` are spliced in place; states without one (and not derived) are
 * inserted after the last ranged state of their root.
 *
 * - An edited state that DIFFERS from its original -> the ORIGINAL's source span is
 *   replaced with the re-serialized block (or a per-field splice) for that state.
 * - An edited state UNCHANGED from its original -> left byte-for-byte (no splice).
 *   This is the locality guarantee: a one-field edit to one state never reflows
 *   any other state's `@N` refs, shorthand, comments, or whitespace.
 * - An original-range span no edited state matched -> its source span is replaced
 *   with an empty string (deletion).
 *
 * `originalModel` - the parse of `originalText` BEFORE the webview's edits - is REQUIRED: it is the
 * only trustworthy range source (see the matching rules below), and every splice anchors on it. An
 * earlier optional-original mode spliced at the edited model's own ranges when no original was given;
 * that is exactly the stale-range corruption path, so the mode was removed rather than kept callable.
 *
 * Matching an edited state to its original: exact source-range key first, then state id within the
 * same root. The id fallback exists because the edited model's ranges can be STALE: while an inline
 * edit is open the webview keeps its optimistic copy through the host's re-parse (adopting would drop
 * the user's draft), so a commit after a structural splice emits a model whose ranges predate the last
 * document revision. Ranges are therefore only ever a MATCHING key on the edited side - every splice
 * anchors on the ORIGINAL side's ranges, which are valid in `originalText` by construction; splicing at
 * an edited-side range corrupted the file or tripped the overlap guard whenever the ranges had shifted.
 * The id fallback is scoped to the state's own root: D state labels are only unique per BEGIN block,
 * not per file (the same duplicate-label hazard `classifyReachability` guards against).
 *
 * Splices are applied from the highest byte offset to the lowest so that earlier
 * offsets remain valid while later ones are being substituted.
 *
 * @throws if `editedModel.sourceLang !== "d"`.
 */
export function applyDDialogEdits(originalText: string, editedModel: DialogModel, originalModel: DialogModel): string {
    if (editedModel.sourceLang !== "d") {
        throw new Error("applyDDialogEdits: only weidu-d models are supported");
    }

    const originalStates = originalModel.roots.flatMap((r) => r.states).filter((s) => s.sourceRange);
    const originalByKey = new Map<string, DialogState>();
    for (const s of originalStates) {
        originalByKey.set(`${s.sourceRange!.start}:${s.sourceRange!.end}`, s);
    }
    // Per-root id index for the stale-range fallback (see the matching rules in the doc comment).
    const originalByRootAndId = new Map<string, Map<string, DialogState>>();
    for (const root of originalModel.roots) {
        const byId = new Map<string, DialogState>();
        for (const s of root.states) if (s.sourceRange) byId.set(s.id, s);
        originalByRootAndId.set(root.id, byId);
    }

    const ops: SpliceOp[] = [];
    // Original-range keys an edited state claimed - the complement is deleted below.
    const matchedKeys = new Set<string>();
    // Edited states with no trustworthy in-place anchor: genuinely new, or unmatchable with stale ranges.
    const toInsert = new Set<DialogState>();

    // Build splice ops only for edited states that ACTUALLY CHANGED. An unchanged
    // state is left untouched so its original bytes survive verbatim.
    for (const root of editedModel.roots) {
        for (const state of root.states) {
            // A derived state (CHAIN/INTERJECT/EXTEND link) has no own span - its bytes live inside the
            // construct that produced it, which is preserved untouched. Never spliced, never inserted.
            if (state.derivedFrom) continue;

            let original: DialogState | undefined;
            if (state.sourceRange) {
                original = originalByKey.get(`${state.sourceRange.start}:${state.sourceRange.end}`);
            }
            if (!original) {
                original = originalByRootAndId.get(root.id)?.get(state.id);
            }

            if (!original) {
                // Newly added (or unmatchable behind stale ranges): serialized by the insert loop
                // below. A stale edited range is never a splice target.
                toInsert.add(state);
                continue;
            }

            const key = `${original.sourceRange!.start}:${original.sourceRange!.end}`;
            if (matchedKeys.has(key)) {
                // Two edited states resolving to the same source block; take the first.
                // A well-formed model should not produce this.
                continue;
            }
            matchedKeys.add(key);

            const view = spliceableView(state);
            if (stateUnchanged(original, view)) {
                // Identical to its source - leave the original bytes in place.
                continue;
            }

            // Prefer a per-field splice (changes only the edited field's span, preserving the
            // rest of the state verbatim); fall back to a whole-state re-serialize otherwise.
            const fieldOps = fieldEditOps(original, view);
            if (fieldOps) {
                ops.push(...fieldOps);
                continue;
            }
            ops.push({
                start: original.sourceRange!.start,
                end: original.sourceRange!.end,
                replacement: serializeStateInPlace(view),
            });
        }
    }

    // Build splice ops for deleted states (original blocks no edited state claimed).
    for (const s of originalStates) {
        const key = `${s.sourceRange!.start}:${s.sourceRange!.end}`;
        if (!matchedKeys.has(key)) {
            matchedKeys.add(key);
            ops.push({ start: s.sourceRange!.start, end: s.sourceRange!.end, replacement: "" });
        }
    }

    // Insert newly-added states right after the last existing (ranged) state of their
    // root, so a new state lands among its siblings. If the root has no ranged state
    // to anchor to, append at the end of the file. This is a zero-width op
    // (start === end), so it composes with the replacements above.
    for (const root of editedModel.roots) {
        const fresh = root.states.filter((s) => toInsert.has(s));
        if (fresh.length === 0) continue;
        // The anchor must be an offset valid in `originalText`: only the fresh parse's ranges
        // qualify (the edited model's can be stale - see the matching rules above).
        let anchor = -1;
        const anchorStates = originalModel.roots.find((r) => r.id === root.id)?.states ?? [];
        for (const s of anchorStates) {
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
            const states = fresh.map((s) => serializeState(spliceableView(s)).join("\n")).join("\n\n");
            ops.push({ start: at, end: at, replacement: `${lead}BEGIN ~${resref}~\n\n${states}\n` });
        } else {
            const block = fresh.map((s) => "\n" + serializeState(spliceableView(s)).join("\n")).join("");
            ops.push({ start: at, end: at, replacement: block });
        }
    }

    // Derived-construct reference rewriting (EXTEND / CHAIN / INTERJECT). These pseudo-states are skipped by the
    // block splicing above - they have no own BEGIN block, their bytes live inside the construct - so a rename or
    // delete of a state they GOTO would otherwise leave a dangling reference in the construct (a WeiDU compile
    // error, e.g. `EXTEND_BOTTOM ... THEN GOTO <renamed>`). `retargetReferences` already updated the EDITED
    // model's derived choices with the correct per-dialogue scoping; mirror that model change into the source by
    // diffing each derived state's original vs edited choices and splicing the ORIGINAL `targetRange` (valid in
    // originalText). Derived states are neither added nor removed by an edit, so original and edited align by
    // position within the root.
    ops.push(...derivedReferenceOps(originalText, originalModel, editedModel));

    // Apply splice ops via the shared core (sorts highest-offset-first so earlier
    // offsets remain valid as the string is modified from the end toward the front).
    return applySplices(originalText, ops);
}

/** Are two targets the same jump? (id/kind equality - enough to detect a rename or a delete-to-exit flip.) */
function sameTarget(a: DialogTarget, b: DialogTarget): boolean {
    if (a.kind === "state" && b.kind === "state") return a.stateId === b.stateId;
    if (a.kind === "external" && b.kind === "external") return a.label === b.label;
    return a.kind === b.kind; // both exit (or a mismatched pair - not the same jump)
}

/**
 * Splice ops that rewrite GOTO references living inside DERIVED constructs (EXTEND/CHAIN/INTERJECT) to match a
 * rename or delete applied to the model. For each derived state, pair original and edited choices by position and,
 * where the target changed:
 *  - to another state (a rename): overwrite the original label span (`targetRange`) with the new id.
 *  - to `exit` (a delete): flip the whole `GOTO <label>` clause to `EXIT` so no dangling jump remains.
 * Only `state`-kind original targets are touched (an `external`/cross-file ref is not a local rename/delete).
 */
function derivedReferenceOps(originalText: string, originalModel: DialogModel, editedModel: DialogModel): SpliceOp[] {
    const editedDerived = new Map<string, DialogState[]>();
    for (const root of editedModel.roots) {
        editedDerived.set(
            root.id,
            root.states.filter((s) => s.derivedFrom),
        );
    }
    const ops: SpliceOp[] = [];
    for (const root of originalModel.roots) {
        const origDerived = root.states.filter((s) => s.derivedFrom);
        const edited = editedDerived.get(root.id) ?? [];
        for (let si = 0; si < origDerived.length; si++) {
            const os = origDerived[si]!;
            const es = edited[si];
            if (!es) continue;
            const n = Math.min(os.choices.length, es.choices.length);
            for (let ci = 0; ci < n; ci++) {
                const oc = os.choices[ci]!;
                const ec = es.choices[ci]!;
                if (oc.target.kind !== "state" || !oc.targetRange || sameTarget(oc.target, ec.target)) continue;
                if (ec.target.kind === "state") {
                    ops.push({ start: oc.targetRange.start, end: oc.targetRange.end, replacement: ec.target.stateId });
                } else if (ec.target.kind === "exit") {
                    // Flip `GOTO <label>` -> `EXIT`: scan back from the label over whitespace to the GOTO keyword
                    // so the jump verb goes too (leaving just the label would be a syntax error). If the keyword
                    // isn't the expected GOTO (an unusual construct), leave it rather than corrupt the source.
                    let s = oc.targetRange.start;
                    while (s > 0 && /\s/.test(originalText[s - 1]!)) s--;
                    if (originalText.slice(Math.max(0, s - 4), s).toUpperCase() === "GOTO") {
                        ops.push({ start: s - 4, end: oc.targetRange.end, replacement: "EXIT" });
                    }
                }
            }
        }
    }
    return ops;
}
