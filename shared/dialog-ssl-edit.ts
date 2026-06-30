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

import type { DialogBranch, DialogChoice, DialogModel, DialogState, DialogTarget } from "./dialog-model";
import { applySplices, type SpliceOp, type VerifyResult } from "./dialog-splice";
import {
    serializeCond,
    serializeSSLBranch,
    serializeSSLConditionalOption,
    serializeSSLOption,
    serializeSSLProcedure,
} from "./dialog-ssl-serialize";

/** Options of a state in source order: the choices that carry a `callRange` (call transitions don't). */
function optionsOf(state: DialogState): DialogChoice[] {
    return state.choices.filter((c) => c.callRange);
}

/** Parse an `@N` ref to its numeric msg id, or NaN if the text is not a bare `@N`. */
function atMsgId(text: string | undefined): number {
    return Number(/^@(\d+)$/.exec((text ?? "").trim())?.[1] ?? NaN);
}
const msgIdOf = (c: DialogChoice): number => atMsgId(c.text);

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
 * Compute the text to write into a slot for one surviving option: retarget when the target changed,
 * or redirect to NMessage when the target node was deleted. Lifted from `nodeOps` so `bundleNodeOps`
 * can share the same retarget/redirect logic without duplication.
 */
function survivorReplacement(text: string, moved: DialogChoice, movedOrig: DialogChoice): string {
    const origCall = text.slice(movedOrig.callRange!.start, movedOrig.callRange!.end);
    if (moved.target.kind !== "state") {
        // The option's target node was deleted (the model redirected it to exit): re-serialize the
        // option as a terminal NMessage, preserving the existing msg id (the first numeric arg of
        // the original call). serializeSSLOption emits a full statement ending in `;`, but the slot
        // is the call expression WITHOUT the trailing `;` - trim it so the existing `;` after the
        // slot stays.
        const msgId = Number(/\(\s*(\d+)/.exec(origCall)?.[1] ?? NaN);
        return Number.isFinite(msgId) ? serializeSSLOption(moved, msgId).replace(/;$/, "") : origCall;
    }
    const newTarget = moved.target.stateId;
    const oldTarget = text.slice(movedOrig.targetRange!.start, movedOrig.targetRange!.end);
    if (newTarget !== oldTarget) {
        const relStart = movedOrig.targetRange!.start - movedOrig.callRange!.start;
        const relEnd = movedOrig.targetRange!.end - movedOrig.callRange!.start;
        return origCall.slice(0, relStart) + newTarget + origCall.slice(relEnd);
    }
    return origCall;
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

    // CONDITION EDITS (Tier 3c). Diff each surviving option's condition; emit splices for edit-text now,
    // wrap/unwrap in later tasks. `wrappedOrUnwrapped` ids are excluded from the survivor slots below
    // (their whole statement is rewritten, which would overlap a survivor callRange splice).
    const wrappedOrUnwrapped = new Set<string>();
    for (const e of editedOpts) {
        const o = origById.get(e.id);
        if (!o) continue; // a new option - not a condition edit
        if (o.conditionEditable !== true) continue; // shared block - condition is source-only
        const had = o.condition !== undefined;
        const has = e.condition !== undefined;
        if (had && has && e.condition !== o.condition && o.condRange) {
            // edit-text: replace the condition expression span only (disjoint from the call's targetRange).
            ops.push({ start: o.condRange.start, end: o.condRange.end, replacement: e.condition! });
        }
        if (!had && has && o.stmtRange) {
            // wrap: replace the flat statement with `if (<cond>) then\n<indent>    <call>;`, serializing
            // the inner call from the EDITED choice so a concurrent retarget is subsumed. Exclude from
            // the survivor slots below to avoid a double-splice on the same stmtRange.
            const lineStart = text.lastIndexOf("\n", o.stmtRange.start - 1) + 1;
            const indent = /^[ \t]*/.exec(text.slice(lineStart, o.stmtRange.start))?.[0] ?? "    ";
            const msgId = Number(
                /^@(\d+)$/.exec((e.text ?? "").trim())?.[1] ??
                    /\(\s*(\d+)/.exec(text.slice(o.callRange!.start, o.callRange!.end))?.[1] ??
                    NaN,
            );
            if (Number.isFinite(msgId)) {
                const wrapped = serializeSSLConditionalOption(e, msgId, e.condition!, indent);
                ops.push({ start: o.stmtRange.start, end: o.stmtRange.end, replacement: wrapped });
                wrappedOrUnwrapped.add(e.id);
            }
        }
        if (had && !has && o.ifRange) {
            // unwrap: replace the whole `if` statement with the inner call alone. `ifRange.start` sits
            // AFTER the line's leading indentation (the statement node's start is post-indent), so the
            // existing indent before the `if` is preserved in place - the replacement is the bare call
            // with no leading indent added.
            const msgId = Number(
                /^@(\d+)$/.exec((e.text ?? "").trim())?.[1] ??
                    /\(\s*(\d+)/.exec(text.slice(o.callRange!.start, o.callRange!.end))?.[1] ??
                    NaN,
            );
            if (Number.isFinite(msgId)) {
                ops.push({ start: o.ifRange.start, end: o.ifRange.end, replacement: serializeSSLOption(e, msgId) });
                wrappedOrUnwrapped.add(e.id);
            }
        }
    }

    // SURVIVORS (Tier 1 retarget + reorder): split into conditional survivors (pinned to their own
    // source slot) and flat survivors (may reorder among flat slots).
    //
    // A conditional option's `callRange` sits inside an `if` wrapper that does not move with the
    // call. Including a conditional option in the flat-reorder permutation would strand its wrapper
    // around a different call (the wrapper stays at its source slot while the call text moves to
    // a different slot). Pinning the conditional survivor to its own slot prevents this: moving a
    // conditional option in the graph keeps it at its source position in the .ssl (its condition
    // stays with it); a cross-boundary reorder of a conditional option is not represented as a
    // position change in the source. This is the conservative, no-corruption behavior.
    // Do NOT implement shared-block splitting or any larger reorder rewrite here.

    // Conditional survivors: pinned - each refills its own callRange slot only, never a different
    // slot. A conditional option's callRange is inside its if-wrapper; if it participated in the
    // flat permutation, the wrapper would end up around the wrong call.
    for (const o of origOpts) {
        if (!editedIds.has(o.id) || wrappedOrUnwrapped.has(o.id) || o.condition === undefined) continue;
        const e = editedOpts.find((c) => c.id === o.id)!;
        const replacement = survivorReplacement(text, e, o);
        if (replacement !== text.slice(o.callRange!.start, o.callRange!.end))
            ops.push({ start: o.callRange!.start, end: o.callRange!.end, replacement });
    }

    // Flat survivors: may reorder among flat slots (source-order slots refilled in edited order).
    const survivorSlots = origOpts
        .filter((o) => editedIds.has(o.id) && !wrappedOrUnwrapped.has(o.id) && o.condition === undefined)
        .map((o) => o.callRange!);
    const survivorsInEditedOrder = editedOpts.filter(
        (c) => origById.has(c.id) && !wrappedOrUnwrapped.has(c.id) && origById.get(c.id)!.condition === undefined,
    );
    for (let i = 0; i < survivorSlots.length; i++) {
        const slot = survivorSlots[i]!;
        const moved = survivorsInEditedOrder[i]!;
        const movedOrig = origById.get(moved.id)!;
        const replacement = survivorReplacement(text, moved, movedOrig);
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
            const block = added
                .filter((c) => Number.isFinite(msgIdOf(c)))
                .map((c) => `\n${indent}${serializeSSLOption(c, msgIdOf(c))}`)
                .join("");
            if (block) ops.push({ start: offset, end: offset, replacement: block });
        }
    }
    return ops;
}

// Bundle-node option edits, branch-scoped. Every option in a branch shares the branch's single
// `if (cond) then begin ... end` wrapper, so within one branch body remove/reorder/retarget/add are the
// same safe operations nodeOps performs for a flat node - no per-option `if` is touched. Each branch body
// is disjoint from the others and from the condition headers, so the splices never overlap. Cross-branch
// moves are out of scope: an option is processed only against the branch it originally belonged to.
//
// Each edited branch is matched to its original by span identity (stmtRange.start for `if` branches,
// elseClauseRange.start for `else` branches), not positional index. A survivor carries these spans from
// the original parse; a pending-new branch (no span) is skipped here and handled by branchStructureOps.
// This prevents a branch add/remove from shifting the index and mis-aligning the option-level ops.
function bundleNodeOps(text: string, edited: DialogState, orig: DialogState): SpliceOp[] {
    const ops: SpliceOp[] = [];
    const ob = orig.branches ?? [];
    const eb = edited.branches ?? [];
    const editedById = new Map(edited.choices.map((c) => [c.id, c]));
    const origById = new Map(orig.choices.map((c) => [c.id, c]));

    // Build lookups keyed by the original branch's identity span start, so a survivor in `eb`
    // (which carries the same span from the parse) resolves to its original regardless of position.
    const origByIfStart = new Map(ob.filter((b) => b.stmtRange).map((b) => [b.stmtRange!.start, b]));
    const origByElseStart = new Map(ob.filter((b) => b.elseClauseRange).map((b) => [b.elseClauseRange!.start, b]));

    for (const ebranch of eb) {
        let obranch: DialogBranch | undefined;
        if (ebranch.stmtRange !== undefined) {
            obranch = origByIfStart.get(ebranch.stmtRange.start);
        } else if (ebranch.elseClauseRange !== undefined) {
            obranch = origByElseStart.get(ebranch.elseClauseRange.start);
        } else {
            continue; // pending-new branch: handled by branchStructureOps
        }
        if (!obranch) continue;

        const origIds = obranch.choiceIds;
        const editedIds = ebranch.choiceIds;
        const keptOrig = origIds.filter((id) => editedIds.includes(id)); // survivors, source order

        // REMOVE: an original option no longer in this branch -> splice its whole statement out.
        for (const id of origIds) {
            if (editedIds.includes(id)) continue;
            const o = origById.get(id);
            if (!o?.stmtRange) return []; // cannot remove safely -> no write
            ops.push(removeStatementSplice(text, o.stmtRange));
        }

        // RETARGET / REORDER: refill this branch's callRange slots (source order) with the kept options in
        // EDITED order. Within one branch body the wrapper does not move, so reorder is safe.
        // Options in a bundle-faithful branch always have a callRange (they are parsed NOption/NMessage calls),
        // so the non-null assertion is safe. Skip any entry that somehow lacks one rather than crashing.
        const slots = keptOrig
            .map((id) => origById.get(id)!.callRange)
            .filter((r): r is NonNullable<typeof r> => r != null);
        const keptEditedOrder = editedIds.filter((id) => origById.has(id));
        for (let k = 0; k < slots.length && k < keptEditedOrder.length; k++) {
            const moved = editedById.get(keptEditedOrder[k]!)!;
            const movedOrig = origById.get(keptEditedOrder[k]!)!;
            const replacement = survivorReplacement(text, moved, movedOrig);
            if (replacement !== text.slice(slots[k]!.start, slots[k]!.end))
                ops.push({ start: slots[k]!.start, end: slots[k]!.end, replacement });
        }
        // ADD: new options in this branch (id absent from orig) -> serialize flat (the branch wrapper
        // already encloses them) at the branch insert anchor with the branch indent.
        // A bare single-statement branch has no insertAnchor (buildBranches only sets it for Block bodies):
        // anchor === undefined -> the guard below is false and add is intentionally a no-op, preventing
        // out-of-block insertion that would corrupt the procedure's structure.
        const anchor = obranch.insertAnchor;
        const added = editedIds
            .filter((id) => !origById.has(id))
            .map((id) => editedById.get(id))
            .filter((c): c is DialogChoice => c !== undefined && isNewSSLOption(c));
        if (added.length > 0 && anchor) {
            const block = added
                .filter((c) => Number.isFinite(msgIdOf(c)))
                .map((c) => `\n${anchor.indent}${serializeSSLOption(c, msgIdOf(c))}`)
                .join("");
            if (block) ops.push({ start: anchor.offset, end: anchor.offset, replacement: block });
        }
    }
    return ops;
}

/**
 * Structural ADD/REMOVE ops for bundle branches.
 *
 * REMOVE: an original branch absent from `edited.branches` (matched by span identity -
 * `stmtRange.start` for `if` branches, `elseClauseRange.start` for `else` branches) is deleted.
 * - `kind:"if"`: `removeStatementSplice` over `stmtRange` (deletes the whole `if` statement,
 *   consuming leading indentation and trailing newline so no blank line is left).
 * - `kind:"else"`: deletes `elseClauseRange` plus the whitespace immediately before the `else`
 *   keyword, so `... end else begin...end` collapses to `... end`.
 * - SIDE-EFFECT GUARD: a branch whose `opaque.length > 0` (carries preserved non-dialog statements
 *   like `set_local_var`) emits NO op - the writer backstop matching the UI's refuse-to-delete.
 *
 * ADD: a PENDING-NEW branch (no `stmtRange` and no `elseClauseRange`) is serialized and inserted.
 * - A new `kind:"if"`: inserted after the last original branch's `stmtRange.end`.
 * - A new `kind:"else"`: injected at the preceding surviving if branch's `thenBlockEnd`.
 *
 * REMOVE ops are disjoint from ADD ops (removed branches and new branches occupy different byte
 * regions) and from `bundleNodeOps` ops (which touch option call spans inside surviving branches
 * only; a removed branch's span is entirely distinct from every survivor's option spans).
 */
function branchStructureOps(text: string, edited: DialogState, orig: DialogState): SpliceOp[] {
    const ops: SpliceOp[] = [];
    const eb = edited.branches;
    const ob = orig.branches;
    if (!eb || !ob) return ops;

    const indent = "    "; // proc-body indent convention (4 spaces)

    // REMOVE: build sets of which original spans survive in the edited branch list.
    // A branch with a stmtRange/elseClauseRange in the edited list is a survivor; one absent is removed.
    const editedIfStarts = new Set(eb.filter((b) => b.stmtRange).map((b) => b.stmtRange!.start));
    const editedElseStarts = new Set(eb.filter((b) => b.elseClauseRange).map((b) => b.elseClauseRange!.start));

    for (const o of ob) {
        if (o.kind === "if") {
            if (!o.stmtRange) continue; // no source span -> nothing to delete
            if (editedIfStarts.has(o.stmtRange.start)) continue; // survivor
            // SIDE-EFFECT GUARD: if the branch carries preserved opaque statements (set_local_var, etc.),
            // emit no op - refuse rather than silently dropping logic the editor never modeled.
            if (o.opaque.length > 0) continue;
            ops.push(removeStatementSplice(text, o.stmtRange));
        } else {
            // kind: "else"
            if (!o.elseClauseRange) continue; // no source span -> nothing to delete
            if (editedElseStarts.has(o.elseClauseRange.start)) continue; // survivor
            // SIDE-EFFECT GUARD
            if (o.opaque.length > 0) continue;
            // Delete the elseClauseRange AND the whitespace immediately before the `else` keyword,
            // so `... end else begin...end` becomes `... end` and multi-line else consumes its
            // leading newline+indent without leaving a blank line.
            const elseStart = o.elseClauseRange.start;
            let wsStart = elseStart;
            while (wsStart > 0 && /[ \t\n\r]/.test(text[wsStart - 1]!)) wsStart--;
            ops.push({ start: wsStart, end: o.elseClauseRange.end, replacement: "" });
        }
    }

    for (const b of eb) {
        // A PENDING-NEW branch has no stmtRange (for if kind) and no elseClauseRange (for else kind).
        // Survivors carry both spans from the original parse; skip them.
        if (b.stmtRange !== undefined || b.elseClauseRange !== undefined) continue;

        // Resolve the options for this new branch from the edited choices, keeping only new SSL options
        // (no callRange/stmtRange, allocated @id text) with a valid numeric id.
        const options = b.choiceIds
            .map((id) => edited.choices.find((c) => c.id === id))
            .filter((c): c is DialogChoice => c !== undefined && isNewSSLOption(c) && Number.isFinite(msgIdOf(c)))
            .map((c) => ({ choice: c, msgId: msgIdOf(c) }));

        if (b.kind === "if") {
            // Insert after the last SURVIVING original branch's stmtRange.end. Anchoring at a
            // removed branch's end would produce a splice that technically overlaps the removal
            // (both touch the same byte range). Filter to originals whose stmtRange.start is in
            // editedIfStarts (the survivor set the REMOVE pass already built above). If all
            // originals are removed alongside this add, fall back to the min original
            // stmtRange.start - a point that precedes any removal and remains inside the
            // procedure body, safe under right-to-left application.
            const allOrigIfStmts = ob.filter((o) => o.stmtRange);
            if (allOrigIfStmts.length === 0) continue; // no original branch with a span - nowhere to anchor
            const survivingOrigEnds = allOrigIfStmts
                .filter((o) => editedIfStarts.has(o.stmtRange!.start))
                .map((o) => o.stmtRange!.end);
            const insertAt =
                survivingOrigEnds.length > 0
                    ? Math.max(...survivingOrigEnds)
                    : Math.min(...allOrigIfStmts.map((o) => o.stmtRange!.start));
            const block = serializeSSLBranch("if", b.condition, [], options, indent);
            ops.push({ start: insertAt, end: insertAt, replacement: `\n${indent}${block}` });
        } else {
            // kind: "else" - inject at the preceding surviving if branch's thenBlockEnd.
            // Scan backwards in edited.branches from this else to find the nearest surviving if (one
            // with stmtRange set, since it was cloned from orig). Then locate that if in orig by its
            // stmtRange.start to read the thenBlockEnd offset the adapter recorded.
            const editedIdx = eb.indexOf(b);
            let precedingIf: DialogBranch | undefined;
            for (let j = editedIdx - 1; j >= 0; j--) {
                const b2 = eb[j]!;
                if (b2.kind === "if" && b2.stmtRange !== undefined) {
                    precedingIf = b2;
                    break;
                }
            }
            if (!precedingIf) continue;
            const origIf = ob.find((o) => o.kind === "if" && o.stmtRange?.start === precedingIf.stmtRange!.start);
            const thenBlockEnd = origIf?.thenBlockEnd;
            if (thenBlockEnd === undefined) continue; // bare then-branch has no thenBlockEnd -> skip
            const block = serializeSSLBranch("else", undefined, [], options, indent);
            ops.push({ start: thenBlockEnd, end: thenBlockEnd, replacement: `\n${indent}${block}` });
        }
    }

    return ops;
}

// Diff each surviving `if` branch's condition against the original and emit a raw span replacement
// into its conditionRange (parens-inclusive). The `else` branch has no condition and is skipped.
// Each edited branch is matched to its original by span identity (stmtRange.start for `if`,
// elseClauseRange.start for `else`), not positional index, so a branch add/remove cannot shift
// the index and mis-splice a surviving branch's new condition onto the removed branch's old span.
// Condition spans are disjoint from option/call spans and from each other, so these splices never
// overlap with one another - but they WOULD overlap with branchStructureOps' whole-branch delete
// if the positional zip paired a surviving branch against a removed original branch. Span-identity
// matching prevents that pairing.
function branchConditionOps(_text: string, edited: DialogState, orig: DialogState): SpliceOp[] {
    const ops: SpliceOp[] = [];
    const eb = edited.branches;
    const ob = orig.branches;
    if (!eb || !ob) return ops;

    // Build lookups keyed by the original branch's identity span start.
    const origByIfStart = new Map(ob.filter((b) => b.stmtRange).map((b) => [b.stmtRange!.start, b]));
    const origByElseStart = new Map(ob.filter((b) => b.elseClauseRange).map((b) => [b.elseClauseRange!.start, b]));

    for (const e of eb) {
        let o: DialogBranch | undefined;
        if (e.stmtRange !== undefined) {
            o = origByIfStart.get(e.stmtRange.start);
        } else if (e.elseClauseRange !== undefined) {
            o = origByElseStart.get(e.elseClauseRange.start);
        } else {
            continue; // pending-new branch: handled by branchStructureOps
        }
        if (!o) continue;
        if (o.kind !== "if" || !o.conditionRange) continue;
        if (e.condition !== undefined && e.condition !== o.condition) {
            ops.push({ start: o.conditionRange.start, end: o.conditionRange.end, replacement: e.condition });
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
                if (c.callSites?.length) {
                    // A call-choice may stand for several `call <oldId>;` statements; rewrite each site's
                    // target token. A site whose target is a call_expr has no targetRange and is skipped.
                    for (const site of c.callSites)
                        if (site.targetRange)
                            ops.push({ start: site.targetRange.start, end: site.targetRange.end, replacement: newId });
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
        // Gate: structurally editable nodes only - plain-faithful or single-level if/else bundles.
        if (!orig || !(orig.faithful || orig.bundleFaithful)) continue;
        if (orig.bundleFaithful) {
            ops.push(...bundleNodeOps(originalText, state, orig));
        } else {
            ops.push(...nodeOps(originalText, state, orig, orig.insertAnchor));
        }
        ops.push(...branchConditionOps(originalText, state, orig));
        ops.push(...branchStructureOps(originalText, state, orig));
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
    // other (surviving) nodes. A call choice on a surviving node has `callSites` set and targets the
    // deleted node - remove every top-level site (a node may call the deleted node more than once). Only
    // splice a site when `topLevel === true` - a call nested in an `if` cannot be removed without rewriting
    // the `if` body, and `eligibleToDelete` already refuses such nodes; this guard is defensive so the
    // splicer stays safe if ever called directly. Entry calls inside talk_p_proc for the
    // same deleted nodes are already handled by the ENTRY WIRING block (a deleted node is absent from
    // `editedById`, so its entry call is removed there); do NOT duplicate that here.
    for (const orig of original.roots.flatMap((r) => r.states)) {
        if (editedIds.has(orig.id) || renamedFromOf.has(orig.id)) continue; // survives or renamed -> nothing to do
        for (const s of original.roots.flatMap((r) => r.states)) {
            if (!editedIds.has(s.id)) continue; // source node was also deleted -> skip
            for (const c of s.choices) {
                if (c.target.kind !== "state" || c.target.stateId !== orig.id) continue;
                if (!c.callSites?.length) continue; // not a call choice
                for (const site of c.callSites) {
                    if (site.topLevel !== true) continue; // nested call - do not splice (leave to condition editing)
                    ops.push(removeStatementSplice(originalText, site.stmtRange));
                }
            }
        }
    }

    // ADD: a new node (no procRange, not derived) -> serialize its whole procedure and splice it in just
    // before talk_p_proc, so it sits among the dialog procedures. Its ids are already on the model as `@N`
    // text (allocated at save), so derive the per-node id map from that text. The inbound option that targets
    // the new node is rewritten by the survivor logic above (the new node's id is a valid state target).
    const anchor = edited.newProcAnchor ?? original.newProcAnchor;
    if (anchor !== undefined) {
        const idOf = atMsgId;
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
    // Additions: an edited node that isEntry but had no entry call in the original. `originalEntries` is keyed
    // by OLD ids, so a renamed node is identified there by `renamedFrom`, not its new id. A renamed node that
    // WAS an entry is excluded (RENAME already rewrote its existing call - adding one would duplicate it); a
    // renamed node that became an entry for the first time is NOT excluded - its rename had no call to rewrite,
    // so it still needs one wired in here.
    const anchorE = original.entryCallAnchor;
    if (anchorE !== undefined) {
        const added = [...editedById.values()].filter((s) => s.isEntry && !originalEntries.has(s.renamedFrom ?? s.id));
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
            // A call nested in an `if` (even in a faithful node) can't be removed without rewriting the `if`.
            if (c.callSites?.some((site) => site.topLevel !== true)) return false;
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
 * option targets AND conditions. Tier 1 retargets and reorders options; Tier 3c wraps/unwraps/edits
 * condition text - both are observable here. A mismatch means the splice did not take (or corrupted
 * the file) and must be surfaced rather than reported as a clean save.
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
        // Encode target + condition per option so a condition that did not land (edit-text, wrap,
        // unwrap) is caught alongside a mismatched target. Canonicalize the condition through
        // serializeCond (the same paren-normalization the writer applies on wrap) then strip
        // whitespace, so a bare typed condition (`X`) matches its written/reparsed form (`(X)`) and is
        // not flagged as a failed save. An option with no condition contributes an empty segment on
        // both sides, so existing target-only tests remain unaffected.
        const normCond = (c?: string): string => (c && c.trim() !== "" ? serializeCond(c).replaceAll(/\s+/g, "") : "");
        const key = (c: DialogChoice): string => `${targetKey(c.target)}@${normCond(c.condition)}`;
        const want = s.choices.map(key).join("|");
        const got = a.choices.map(key).join("|");
        if (want !== got)
            return { ok: false, reason: `node "${a.id}" option targets/conditions differ from the intended edit` };
        const branchKey = (st: DialogState): string =>
            (st.branches ?? []).map((b) => `${b.kind}:${b.kind === "if" ? normCond(b.condition) : ""}`).join("|");
        if (branchKey(s) !== branchKey(a))
            return { ok: false, reason: `node "${a.id}" branch conditions differ from the intended edit` };
    }
    return { ok: true };
}
