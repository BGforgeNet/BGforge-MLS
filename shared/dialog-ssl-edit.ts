/**
 * Surgical in-place editor for Fallout SSL dialog source (retarget/reorder/add/remove options;
 * add/delete nodes).
 *
 * SSL is a full scripting language, so the graph is only an approximation of a procedure. Only
 * nodes the graph represents *faithfully* (flat dialog calls + single-level `if`, no else/loop/
 * nested-if/assignment - see `SSLDialogNode.faithful`) are structurally editable; an edit to a
 * non-faithful node is ignored so we never corrupt control flow the graph never captured.
 *
 * Tier 1 (retarget + reorder) rearranges/rewrites existing option-call byte spans. Tier 2 adds
 * removal (delete a flat option's whole statement) and insertion (serialize a new `NOption`/
 * `NMessage` whose `.msg` id was allocated at save time - see dialog-ssl-ids.ts - and splice it in
 * after the last surviving option). `nodeOps` composes all four as non-overlapping splices per node.
 * Tier 3a adds whole-node ops in `applySSLDialogEdits`: DELETE removes an absent node's `procedure`
 * span (its inbound options redirect to a terminal `NMessage` via the survivor logic), and ADD
 * serializes a new node's `procedure` (see dialog-ssl-serialize.ts) and splices it before `talk_p_proc`.
 * `eligibleToDelete` gates which nodes the editor may delete. Tier 3b adds: entry wiring (splice a `call
 * NodeX;` into/out of `talk_p_proc` from a node's `isEntry` flag); inbound-call removal on delete (top-level
 * `call` statements spliced out) so entry/call-referenced nodes are deletable; and node RENAME (rewrite the
 * `procedure` name token + every reference - faithful-node option targets via `nodeOps`, calls/non-faithful
 * option targets/entry calls via the RENAME block, split to avoid double-splicing a span). Adding/removing a
 * CONDITIONAL option (inside an `if`) and condition editing remain deferred.
 */

import type { DialogChoice, DialogModel, DialogState, DialogTarget } from "./dialog-model";
import type { VerifyResult } from "./dialog-d-edit";
import { applySplices, type SpliceOp } from "./dialog-splice";
import { serializeSSLOption, serializeSSLProcedure } from "./dialog-ssl-serialize";

/** Options of a state in source order: the choices that carry a `callRange` (call transitions don't). */
function optionsOf(state: DialogState): DialogChoice[] {
    return state.choices.filter((c) => c.callRange);
}

// A NEW option: no source range of ANY kind (never existed in the .ssl) and an allocated `@<id>` text (the id
// is assigned at save time, before the splice). Distinct from dialog-ssl-ids.ts's pre-allocation `isNewOption`
// (literal text); here the id has already been assigned. The `stmtRange` check is what separates a freshly-added
// option from an EXISTING terminal message (`NMessage`/`GMessage`/`BMessage`): a message carries no `callRange`
// (it has no target node) but the parser records its `stmtRange`, so without this guard an existing message
// would be misread as new and re-appended (duplicated) on every structural save.
function isNewSSLOption(c: DialogChoice): boolean {
    return c.callRange === undefined && c.stmtRange === undefined && /^@\d+$/.test((c.text ?? "").trim());
}

/**
 * A splice op that deletes a whole statement, also consuming its line's leading indentation and trailing
 * newline WHEN the statement is the only non-whitespace content on its line - so removing it leaves no stray
 * blank line. When something else shares the line, only the statement span itself is removed. Shared by every
 * statement-removal site (option remove, inbound `call` remove, talk_p_proc entry-call remove).
 */
function removeStatementSplice(text: string, stmtRange: { start: number; end: number }): SpliceOp {
    const lineStart = text.lastIndexOf("\n", stmtRange.start - 1) + 1;
    const lead = text.slice(lineStart, stmtRange.start);
    const start = /^[ \t]*$/.test(lead) ? lineStart : stmtRange.start;
    const nl = text.indexOf("\n", stmtRange.end);
    const end = start === lineStart && nl !== -1 ? nl + 1 : stmtRange.end;
    return { start, end, replacement: "" };
}

/**
 * Build the splice ops for one faithful node. Composes three edit kinds, all non-overlapping:
 * - REMOVE: an original (unconditional) option absent from the edit -> delete its whole statement.
 * - SURVIVORS: Tier 1 retarget + reorder over options that still exist, by refilling their source slots.
 * - ADD: a new option (no `callRange`, allocated `@id`) -> serialize and insert at the node anchor.
 * Bails (returns no ops) if a conditional option is added/removed (would rewrite the `if` wrapper - Tier 3).
 */
function nodeOps(
    text: string,
    edited: DialogState,
    orig: DialogState,
    anchor: { offset: number; indent: string } | undefined,
): SpliceOp[] {
    const origOpts = optionsOf(orig); // existing-in-source options (have a callRange), in source order
    const editedOpts = edited.choices.filter((c) => c.callRange || isNewSSLOption(c));
    const origById = new Map(origOpts.map((c) => [c.id, c]));
    const editedIds = new Set(editedOpts.map((c) => c.id));
    const ops: SpliceOp[] = [];

    // Adding/removing a CONDITIONAL option would rewrite its `if` wrapper (Tier 3): bail (no structural write).
    // On DialogChoice the enclosing-if text is `condition` (the SSL adapter maps SSLDialogOption.conditional ->
    // DialogChoice.condition).
    for (const o of origOpts) if (!editedIds.has(o.id) && o.condition) return [];

    // REMOVE: an original option absent from the edit -> splice its whole statement out, consuming the line's
    // leading indentation and trailing newline so no stray blank line is left (only when the lead is all
    // whitespace - otherwise something shares the line and we delete just the statement).
    for (const o of origOpts) {
        if (editedIds.has(o.id)) continue;
        if (!o.stmtRange) return []; // no statement span -> cannot remove safely
        ops.push(removeStatementSplice(text, o.stmtRange));
    }

    // SURVIVORS (Tier 1 retarget + reorder, restricted to options that still exist): the original
    // source-ordered slots of surviving options, each refilled with the survivor now at that position.
    const survivorSlots = origOpts.filter((o) => editedIds.has(o.id)).map((o) => o.callRange!);
    const survivorsInEditedOrder = editedOpts.filter((c) => origById.has(c.id));
    for (let i = 0; i < survivorSlots.length; i++) {
        const slot = survivorSlots[i]!;
        const moved = survivorsInEditedOrder[i]!;
        const movedOrig = origById.get(moved.id)!;
        const origCall = text.slice(movedOrig.callRange!.start, movedOrig.callRange!.end);
        let replacement: string;
        if (moved.target.kind !== "state") {
            // The option's target node was deleted (the model redirected it to exit): re-serialize the option
            // as a terminal NMessage, preserving the existing msg id (the first numeric arg of the original
            // call). serializeSSLOption emits a full statement ending in `;`, but the slot is the call
            // expression WITHOUT the trailing `;` - trim it so the source's existing `;` after the slot stays.
            const msgId = Number(/\(\s*(\d+)/.exec(origCall)?.[1] ?? NaN);
            replacement = Number.isFinite(msgId) ? serializeSSLOption(moved, msgId).replace(/;$/, "") : origCall;
        } else {
            const newTarget = moved.target.stateId;
            const oldTarget = text.slice(movedOrig.targetRange!.start, movedOrig.targetRange!.end);
            replacement = origCall;
            if (newTarget !== oldTarget) {
                const relStart = movedOrig.targetRange!.start - movedOrig.callRange!.start;
                const relEnd = movedOrig.targetRange!.end - movedOrig.callRange!.start;
                replacement = origCall.slice(0, relStart) + newTarget + origCall.slice(relEnd);
            }
        }
        if (replacement !== text.slice(slot.start, slot.end))
            ops.push({ start: slot.start, end: slot.end, replacement });
    }

    // ADD: each new option (no callRange, allocated @id) -> serialize and insert as a zero-width splice.
    // Anchor after the last SURVIVING option's statement (whose span is never deleted), so the insert can
    // never land inside a removed option's range; fall back to the parser node anchor only when no option
    // survives. `indent` is the parser-captured body indentation.
    const added = editedOpts.filter((c) => isNewSSLOption(c) && !origById.has(c.id));
    if (added.length > 0) {
        const survivorEnds = origOpts.filter((o) => editedIds.has(o.id) && o.stmtRange).map((o) => o.stmtRange!.end);
        const offset = survivorEnds.length > 0 ? Math.max(...survivorEnds) : anchor?.offset;
        const indent = anchor?.indent ?? "    ";
        if (offset !== undefined) {
            const msgIdOf = (c: DialogChoice): number => Number(/^@(\d+)$/.exec((c.text ?? "").trim())?.[1] ?? NaN);
            const block = added
                .filter((c) => Number.isFinite(msgIdOf(c)))
                .map((c) => `\n${indent}${serializeSSLOption(c, msgIdOf(c))}`)
                .join("");
            if (block) ops.push({ start: offset, end: offset, replacement: block });
        }
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

    // RENAME: an edited node carrying `renamedFrom` is an existing node whose id changed. Rewrite its procedure
    // name token and the references nodeOps does NOT handle. Exclude it from the delete loop (its old id looks
    // "missing") and the add loop (its new id has no procRange).
    const renamedFromOf = new Map<string, string>(); // oldId -> newId
    for (const s of edited.roots.flatMap((r) => r.states)) {
        // `renamedFrom !== s.id` skips a no-op rename (renamedFrom set but id unchanged) - nothing to rewrite.
        if (s.renamedFrom && s.renamedFrom !== s.id) renamedFromOf.set(s.renamedFrom, s.id);
    }
    for (const [oldId, newId] of renamedFromOf) {
        const orig = origById.get(oldId);
        if (!orig?.nameRange) continue;
        ops.push({ start: orig.nameRange.start, end: orig.nameRange.end, replacement: newId });
        // The forward declaration (`procedure <name>;`) carries a second name token; rewrite it too, or the
        // file keeps an orphan decl for the old name while the renamed procedure is undeclared (sslc rejects
        // both). Disjoint from nameRange (decl is above the definition). Absent when the proc has no forward decl.
        if (orig.forwardDeclRange)
            ops.push({ start: orig.forwardDeclRange.start, end: orig.forwardDeclRange.end, replacement: newId });
        // Rewrite ONLY references nodeOps does NOT handle, to avoid double-splicing the same span:
        //  - call-statement targets (nodeOps only touches OPTION calls, never `call` statements);
        //  - option targets in NON-faithful nodes (nodeOps skips non-faithful nodes entirely).
        // An option target in a FAITHFUL node is left to the per-node survivor retarget: renameState already updated
        // that option's model target to newId, so nodeOps rewrites its targetRange. Rewriting it here too would push
        // a SECOND op on the identical span -> overlap corruption.
        for (const s of original.roots.flatMap((r) => r.states)) {
            for (const c of s.choices) {
                if (c.target.kind !== "state" || c.target.stateId !== oldId) continue;
                if (c.callTargetRange) {
                    ops.push({ start: c.callTargetRange.start, end: c.callTargetRange.end, replacement: newId });
                } else if (c.targetRange && s.faithful !== true) {
                    ops.push({ start: c.targetRange.start, end: c.targetRange.end, replacement: newId });
                }
                // option target in a faithful node -> handled by nodeOps (do nothing here).
            }
        }
        for (const ec of original.entryCalls ?? []) {
            if (ec.name === oldId)
                ops.push({ start: ec.targetRange.start, end: ec.targetRange.end, replacement: newId });
        }
    }

    for (const state of edited.roots.flatMap((r) => r.states)) {
        // A renamed node's id is its NEW id; origById is keyed by ORIGINAL ids, so resolve via renamedFrom.
        // This lets nodeOps process the renamed node's own options against its original, AND lets a faithful
        // node referencing the renamed node retarget that option's targetRange to the new id.
        const orig = origById.get(state.renamedFrom ?? state.id);
        if (!orig || !orig.faithful) continue; // gate: only faithful nodes are structurally editable
        ops.push(...nodeOps(originalText, state, orig, orig.insertAnchor));
    }

    // DELETE: an original node missing from the edited model -> remove its whole procedure span (and the
    // blank line it would leave). Inbound options were redirected to a terminal NMessage by the survivor
    // logic above (their target changed state -> exit in the edited model). A deleted node's procedure span
    // never overlaps another node's option slots (procedures are disjoint), and a redirected inbound option
    // lives in a DIFFERENT surviving node, so this deletion and that slot rewrite cannot overlap.
    const editedIds = new Set(edited.roots.flatMap((r) => r.states).map((s) => s.id));
    for (const orig of original.roots.flatMap((r) => r.states)) {
        // A renamed-away old id is absent from editedIds but is NOT a deletion (the RENAME block rewrote it).
        if (editedIds.has(orig.id) || !orig.procRange || renamedFromOf.has(orig.id)) continue;
        const start = orig.procRange.start;
        const nl = originalText.indexOf("\n", orig.procRange.end);
        const end = nl === -1 ? orig.procRange.end : nl + 1;
        ops.push({ start, end, replacement: "" });
    }

    // INBOUND CALL REMOVAL: for each deleted node, remove any inbound `call <node>;` statements inside
    // other (surviving) nodes. A call choice on a surviving node has `callStmtRange` set and targets the
    // deleted node. Only splice when `callTopLevel === true` - a call nested in an `if` cannot be removed
    // without rewriting the `if` body, and `eligibleToDelete` already refuses such nodes; this guard is
    // defensive so the splicer stays safe if ever called directly. Entry calls inside talk_p_proc for the
    // same deleted nodes are already handled by the ENTRY WIRING block (a deleted node is absent from
    // `editedById`, so its entry call is removed there); do NOT duplicate that here.
    for (const orig of original.roots.flatMap((r) => r.states)) {
        if (editedIds.has(orig.id) || renamedFromOf.has(orig.id)) continue; // survives or renamed -> nothing to do
        for (const s of original.roots.flatMap((r) => r.states)) {
            if (!editedIds.has(s.id)) continue; // source node was also deleted -> skip
            for (const c of s.choices) {
                if (c.target.kind !== "state" || c.target.stateId !== orig.id) continue;
                if (!c.callStmtRange) continue; // not a call choice
                if (c.callTopLevel !== true) continue; // nested call - do not splice (leave to condition editing)
                ops.push(removeStatementSplice(originalText, c.callStmtRange));
            }
        }
    }

    // ADD: a new node (no procRange, not derived) -> serialize its whole procedure and splice it in just
    // before talk_p_proc, so it sits among the dialog procedures. Its ids are already on the model as `@N`
    // text (allocated at save), so derive the per-node id map from that text. The inbound option that targets
    // the new node is rewritten by the survivor logic above (the new node's id is a valid state target).
    const anchor = edited.newProcAnchor ?? original.newProcAnchor;
    if (anchor !== undefined) {
        const idOf = (t: string | undefined): number => Number(/^@(\d+)$/.exec((t ?? "").trim())?.[1] ?? NaN);
        const blocks: string[] = [];
        for (const s of edited.roots.flatMap((r) => r.states)) {
            if (s.procRange || s.derivedFrom || s.renamedFrom) continue; // existing, derived, or renamed -> not a new node
            const ids = {
                reply: Number.isFinite(idOf(s.text)) ? idOf(s.text) : undefined,
                options: Object.fromEntries(
                    s.choices.filter((c) => Number.isFinite(idOf(c.text))).map((c) => [c.id, idOf(c.text)]),
                ),
            };
            blocks.push(serializeSSLProcedure(s, ids, "    "));
        }
        if (blocks.length > 0)
            ops.push({ start: anchor, end: anchor, replacement: blocks.map((b) => `${b}\n`).join("") });
    }

    // ENTRY WIRING: a node that became an entry -> splice `call <id>;` into talk_p_proc after the last
    // existing body statement; one that ceased being an entry (toggled off OR deleted) -> remove its
    // `call` statement. Overlap reasoning: entry-call removal spans live inside talk_p_proc, which is
    // disjoint from every node procedure and from any option slot; the addition is a zero-width splice
    // at entryCallAnchor (end of talk_p_proc's last body statement). A node that is both deleted AND was
    // an entry produces two ops: the procedure deletion (in its own procedure) and the entry-call removal
    // (in talk_p_proc) - the two procedures are disjoint so the ops cannot overlap.
    const originalEntries = new Set(original.entryIds);
    const editedById = new Map(edited.roots.flatMap((r) => r.states).map((s) => [s.id, s]));
    // Removals: an original entry whose edited node is gone or no longer isEntry.
    for (const ec of original.entryCalls ?? []) {
        // A renamed entry's old id is absent from editedById, but its call must NOT be removed - the RENAME block
        // already rewrote its targetRange (a span inside stmtRange), so a removal here would overlap that op.
        if (renamedFromOf.has(ec.name)) continue;
        const e = editedById.get(ec.name);
        if (e && e.isEntry) continue; // still an entry -> keep
        if (!ec.topLevel) continue; // conditional entry (`if (X) call ...;`) - outside scope of this tier
        ops.push(removeStatementSplice(originalText, ec.stmtRange));
    }
    // Additions: an edited node that isEntry but was not an original entry. Exclude a renamed node: its new id
    // is absent from originalEntries (keyed by old ids), but its entry call already exists (RENAME rewrote its
    // target), so adding one here would duplicate it.
    const anchorE = original.entryCallAnchor;
    if (anchorE !== undefined) {
        const added = [...editedById.values()].filter((s) => s.isEntry && !s.renamedFrom && !originalEntries.has(s.id));
        if (added.length > 0) {
            const indent = "    ";
            ops.push({
                start: anchorE,
                end: anchorE,
                replacement: added.map((s) => `\n${indent}call ${s.id};`).join(""),
            });
        }
    }

    return applySplices(originalText, ops);
}

/**
 * Whether an SSL node can be safely deleted from the graph. A node is eligible unless an inbound reference
 * cannot be cleaned up by the writer:
 * - a conditional entry (a `call` nested in an `if` inside talk_p_proc) cannot be removed without rewriting
 *   the `if` - defer to condition editing; a top-level entry call IS removable (the writer splices it out);
 * - an inbound option or call in a non-faithful node cannot be rewritten, so its target would be left dangling;
 * - an inbound call nested in an `if` (non-top-level) cannot be spliced without rewriting the `if` body.
 * Top-level entry calls and top-level inbound calls in faithful nodes are both cleanly removable by the writer,
 * so those cases no longer block deletion (Tier 3b).
 * Non-SSL models defer to their own delete rules (D states are deletable when not derived).
 */
export function eligibleToDelete(model: DialogModel, stateId: string): boolean {
    if (model.format !== "fallout-ssl") return true;
    // A conditional entry (a `call` nested in an `if` inside talk_p_proc) cannot be removed without rewriting
    // the `if` - defer to condition editing.
    for (const ec of model.entryCalls ?? []) if (ec.name === stateId && !ec.topLevel) return false;
    // A `force_dialog_start`/`start_dialog_at_node` entry is in `entryIds` but has NO `entryCalls` entry - the
    // call lives in a non-dialog procedure (a timer/map-enter handler) the writer cannot reach. Removing the
    // node's procedure would leave that call dangling, so refuse (the entry toggle gates the same case).
    if ((model.entryIds ?? []).includes(stateId) && !(model.entryCalls ?? []).some((ec) => ec.name === stateId))
        return false;
    for (const s of model.roots.flatMap((r) => r.states)) {
        for (const c of s.choices) {
            if (c.target.kind !== "state" || c.target.stateId !== stateId) continue;
            if (s.faithful !== true) return false; // inbound option/call in a node whose source we cannot rewrite
            if (c.callStmtRange && c.callTopLevel !== true) return false; // call nested in an `if` (even if faithful)
        }
    }
    return true;
}

/** Stable key for a transition target, so option order/targets can be compared structurally. */
function targetKey(t: DialogTarget): string {
    if (t.kind === "state") return `state:${t.stateId}`;
    if (t.kind === "external") return `external:${t.label}`;
    return "exit";
}

/**
 * Confirm an SSL structural save landed as intended: every node in `actual` (the re-parse of the
 * saved `.ssl`) matches its counterpart in `intended` (the model the editor wrote) on the ordered
 * option targets. Tier 1 only retargets and reorders options, so the ordered target sequence is the
 * observable; a mismatch means the splice did not take (or corrupted the file) and must be surfaced
 * rather than reported as a clean save.
 *
 * The comparison iterates over `actual`, not `intended`: a retarget can leave a node unreachable, and
 * the parser prunes unreachable procedures, so an orphaned node legitimately disappears from the
 * re-parse - that is an expected consequence of the edit, not a failure. Tier 1 splices replace only
 * option-call spans inside a faithful node, so they can never remove a procedure; a node missing from
 * `actual` is therefore always an orphan, never lost data. Non-fallout-ssl models are never written
 * here, so they always verify.
 */
export function verifySSLEditApplied(intended: DialogModel, actual: DialogModel): VerifyResult {
    if (intended.format !== "fallout-ssl") return { ok: true };
    const intendedById = new Map(intended.roots.flatMap((r) => r.states).map((s) => [s.id, s]));
    for (const a of actual.roots.flatMap((r) => r.states)) {
        const s = intendedById.get(a.id);
        if (!s) return { ok: false, reason: `unexpected node "${a.id}" in the saved file` };
        const want = s.choices.map((c) => targetKey(c.target)).join("|");
        const got = a.choices.map((c) => targetKey(c.target)).join("|");
        if (want !== got)
            return { ok: false, reason: `node "${a.id}" option targets/order differ from the intended edit` };
    }
    return { ok: true };
}
