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
 *
 * Reaction (N/G/B) and low-INT variant edits rewrite a surviving option's macro call in place, sharing
 * `survivorReplacement` with retarget so all three compose in one save: a reaction-only change swaps just
 * the macro-name token (leaving the msg-id/target/skill args byte-exact); a low-INT toggle rebuilds the
 * whole call (the Low/non-Low forms differ in arg count - see `serializeSSLOptionCall`), preserving the
 * msg-id argument's exact source text via `splitCallArgs`.
 */

import {
    renderFamily,
    sslTerminalKind,
    type DialogBranch,
    type DialogChoice,
    type DialogModel,
    type DialogState,
} from "./dialog-model";
import { applySplices, type SpliceOp } from "./dialog-splice";
import {
    type NodeMsgIds,
    serializeSSLBranch,
    serializeSSLConditionalOption,
    serializeSSLDialogScaffold,
    serializeSSLOption,
    serializeSSLOptionCall,
    serializeSSLProcedure,
    serializeSSLReply,
    serializeSupportProcedure,
    sslOptionMacro,
} from "./dialog-ssl-serialize";
import { allStates, bareMsgId, isAllocatedNewOption } from "./dialog-edit-common";

/** Options of a state in source order: the choices that carry a `callRange` (call transitions don't). */
function optionsOf(state: DialogState): DialogChoice[] {
    return state.choices.filter((c) => c.callRange);
}

/** Parse an `@N` ref to its numeric msg id, or NaN if the text is not a bare `@N` (the shared `bareMsgId`
 *  parser with this file's NaN sentinel, so the many `Number.isFinite(...)` call sites below are unchanged). */
const atMsgId = (text: string | undefined): number => bareMsgId(text) ?? NaN;
const msgIdOf = (c: DialogChoice): number => atMsgId(c.text);

/**
 * The reply + per-option msg ids of a NEW node, read off the `@N` text the save path allocated (see
 * dialog-source-edit.ts). An empty-text reply and any option still lacking an id are omitted. Shared by
 * the ADD-node splice and the from-scratch scaffold so the id-derivation rule lives once.
 */
function newNodeMsgIds(s: DialogState): NodeMsgIds {
    return {
        reply: Number.isFinite(atMsgId(s.text)) ? atMsgId(s.text) : undefined,
        options: Object.fromEntries(
            s.choices.filter((c) => Number.isFinite(atMsgId(c.text))).map((c) => [c.id, atMsgId(c.text)]),
        ),
    };
}

/**
 * An SSL node the editor created locally: no source procedure (`procRange`) yet, and not a derived
 * (CHAIN/INTERJECT) view or a renamed existing node. Such a node is fully known and safely editable by
 * construction, so the webview treats it as structurally editable immediately - before any save round-trip
 * gives it a `faithful` flag (only the parser sets that). It is also the node the ADD-node splicer serializes
 * into the file, gated additionally on `!committed` there so a node already spliced on a prior save is not
 * re-emitted; this predicate deliberately still accepts a committed node, which remains ours to edit.
 */
export function isLocalNewSSLNode(s: DialogState): boolean {
    return !s.procRange && !s.derivedFrom && !s.renamedFrom;
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

/** The identifier token at the very start of a call span (its macro name, e.g. "NOption"). */
function macroNameOf(callText: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*/.exec(callText)?.[0] ?? "";
}

/**
 * Split a call expression's parenthesized argument list into top-level argument texts, respecting
 * nested parens - so a `random(1, 2, 3)` msg-id argument is not split on its own internal commas.
 * `call` is a callRange slice, e.g. `NOption(101, Node002, 4)`. Returns `[]` if `call` has no parens.
 */
function splitCallArgs(call: string): string[] {
    const open = call.indexOf("(");
    const close = call.lastIndexOf(")");
    if (open === -1 || close === -1 || close <= open) return [];
    const inner = call.slice(open + 1, close);
    const args: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) {
            args.push(inner.slice(start, i).trim());
            start = i + 1;
        }
    }
    args.push(inner.slice(start).trim());
    return args;
}

/**
 * Compute the text to write into a slot for one surviving option: retarget when the target changed,
 * redirect to NMessage when the target node was deleted, and rewrite the reaction (N/G/B) and/or the
 * low-INT variant when either changed vs the original. Lifted from `nodeOps` so `bundleNodeOps` can
 * share the same logic without duplication.
 */
export function survivorReplacement(text: string, moved: DialogChoice, movedOrig: DialogChoice): string {
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
    const lowChanged = Boolean(moved.lowIq) !== Boolean(movedOrig.lowIq);

    if (lowChanged) {
        // The Low/non-Low forms differ in arg count (2-arg vs 3-arg), so a token-level patch can't
        // express the change - rebuild the whole call. splitCallArgs preserves the msg-id argument's
        // exact source text (not just its numeric value) so a computed/random msgId expression
        // round-trips untouched; only the macro name and arg list are rewritten.
        const msgIdText = splitCallArgs(origCall)[0];
        return msgIdText !== undefined ? serializeSSLOptionCall(moved, msgIdText, newTarget) : origCall;
    }

    // Arg count is unchanged here: patch the target (if retargeted) and/or the macro name (if the
    // reaction changed) as independent, order-safe token replacements, in "current string" coordinates
    // so a target replacement (interior) and a macro replacement (prefix) never invalidate each
    // other's offsets - never touching the msg-id/skill args, so an untouched expression there (a
    // computed msgId, a non-decimal skill literal) survives byte-exact.
    let call = origCall;
    if (newTarget !== oldTarget) {
        const relStart = movedOrig.targetRange!.start - movedOrig.callRange!.start;
        const relEnd = movedOrig.targetRange!.end - movedOrig.callRange!.start;
        call = call.slice(0, relStart) + newTarget + call.slice(relEnd);
    }
    if ((moved.reaction ?? "neutral") !== (movedOrig.reaction ?? "neutral")) {
        const macro = macroNameOf(call);
        if (macro) call = `${sslOptionMacro(moved)}${call.slice(macro.length)}`;
    }
    return call;
}

/**
 * Build the splice ops for one faithful node. Composes three edit kinds, all non-overlapping:
 * - REMOVE: an original (unconditional) option absent from the edit -> delete its whole statement.
 * - SURVIVORS: Tier 1 retarget + reorder over options that still exist, by refilling their source slots.
 * - ADD: a new option (no `callRange`, allocated `@id`) -> serialize and insert at the node anchor.
 * Bails (returns no ops) if a conditional option is added/removed (would rewrite the `if` wrapper - Tier 3).
 */
/**
 * The shared fallout-ssl-family flat-node option engine: remove / retarget / reorder / terminal-flip /
 * condition-edit / add-option for one structurally-editable (non-bundle) node. Both the SSL writer
 * (`applySSLDialogEdits`) and the TSSL writer (`applyTSSLDialogEdits`) route their per-node option handling
 * through this ONE implementation, so the two source variants of the family cannot drift (the recurring
 * "TSSL parity" defect). Everything it emits uses the byte-identical option/reply call syntax both variants
 * share (`serializeSSLOption`/`serializeSSLReply`/`survivorReplacement`); the ONE piece that differs by target
 * syntax - wrapping a flat option INTO a conditional (`if (c) then ...` vs `if (c) { ... }`) - is injected via
 * `serializeConditionalOption` (SSL `serializeSSLConditionalOption`, TSSL `serializeTSSLConditionalOption`). The
 * parameter is optional so a caller may omit it and degrade to leaving the option flat rather than crashing;
 * unwrap and condition edit-text, whose output is the shared bare call, work regardless.
 *
 * `anchor` is the fallback insertion point for a NEW option on a node with no surviving option (a reply-only
 * node): SSL passes the parser-captured `insertAnchor`; TSSL passes a close-brace-derived anchor. When the node
 * has a surviving option, the new option anchors after it and this is unused.
 */
export function nodeOps(
    text: string,
    edited: DialogState,
    orig: DialogState,
    anchor: { offset: number; indent: string } | undefined,
    serializeConditionalOption?: (choice: DialogChoice, msgId: number, condition: string, indent: string) => string,
): SpliceOp[] {
    const origOpts = optionsOf(orig); // existing-in-source options (have a callRange), in source order
    const editedOpts = edited.choices.filter((c) => c.callRange || isAllocatedNewOption(c));
    const origById = new Map(origOpts.map((c) => [c.id, c]));
    const editedIds = new Set(editedOpts.map((c) => c.id));
    const ops: SpliceOp[] = [];

    // TERMINAL -> NODE flip: a source terminal message (NMessage, a `stmtRange` but no `callRange`) retargeted to
    // a node. It is invisible to the logic below (origOpts/editedOpts are callRange-based), so the survivor
    // rewrite - which only edits an existing call's target token - can't turn it into an NOption. Replace the
    // whole statement with the node-call form. (The reverse, node -> exit, already works: a node option carries a
    // callRange, so survivorReplacement serializes its edited exit target to an NMessage in place.) A conditional
    // terminal is left to Tier 3. `stmtRange` spans the whole statement incl. its `;`, matching serializeSSLOption.
    for (const c of edited.choices) {
        if (!c.stmtRange || c.callRange || c.condition || c.target.kind !== "state") continue;
        const msgId = atMsgId(c.text);
        if (Number.isFinite(msgId))
            ops.push({ start: c.stmtRange.start, end: c.stmtRange.end, replacement: serializeSSLOption(c, msgId) });
    }

    // REMOVE: an original option absent from the edit -> splice it out. A PURE conditional option (its `if` gates
    // it alone, `conditionEditable`) removes the whole `if`; a flat or shared-condition option removes just its
    // own statement. The SSL engine previously BAILED on any conditional-option removal (returned no ops for the
    // whole node, deferring to a later tier); TSSL's writer already removed pure-conditional options this way, so
    // the unified engine adopts it - SSL gains safe conditional-option removal at parity with TSSL. A shared-block
    // conditional (`conditionEditable === false`) removes only its own call, never the `if` that also gates its
    // siblings. Line-aware `removeStatementSplice` eats the option's line cleanly (no stray blank line).
    //
    // BOUNDARY: when EVERY option of one shared `if` block is removed in the same save (a rapid double-remove the
    // 250ms edit-debounce can coalesce into one edit), splicing each option's line individually would leave a dead
    // `if (...) then begin end` husk. Detect a fully-emptied shared `if` and splice the whole `if` once instead.
    const ifKey = (r: { start: number; end: number }): string => `${r.start}:${r.end}`;
    const sharedIf = new Map<string, { total: number; removed: number }>();
    for (const o of origOpts) {
        if (!o.ifRange || o.conditionEditable !== false) continue; // only multi-call shared blocks (impure `if`)
        const k = ifKey(o.ifRange);
        const e = sharedIf.get(k) ?? { total: 0, removed: 0 };
        e.total++;
        if (!editedIds.has(o.id)) e.removed++;
        sharedIf.set(k, e);
    }
    const emptiedIfs = new Set([...sharedIf].filter(([, v]) => v.removed === v.total).map(([k]) => k));
    const splicedEmptiedIfs = new Set<string>();
    for (const o of origOpts) {
        if (editedIds.has(o.id)) continue;
        // Shared `if` whose every option is being removed -> splice the whole `if` once (dedup across its options).
        if (o.ifRange && o.conditionEditable === false && emptiedIfs.has(ifKey(o.ifRange))) {
            const k = ifKey(o.ifRange);
            if (splicedEmptiedIfs.has(k)) continue;
            splicedEmptiedIfs.add(k);
            ops.push(removeStatementSplice(text, o.ifRange));
            continue;
        }
        const removeSpan = o.ifRange && o.conditionEditable !== false ? o.ifRange : o.stmtRange;
        if (!removeSpan) return []; // no removable span -> cannot remove safely
        ops.push(removeStatementSplice(text, removeSpan));
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
        if (!had && has && o.stmtRange && serializeConditionalOption) {
            // wrap: replace the flat statement with the target syntax's conditional form, serializing the inner
            // call from the EDITED choice so a concurrent retarget is subsumed. Exclude from the survivor slots
            // below to avoid a double-splice on the same stmtRange. Both family variants inject a serializer (SSL
            // `serializeSSLConditionalOption`, TSSL `serializeTSSLConditionalOption`); the guard remains so a caller
            // that omits one degrades to leaving the option flat rather than crashing.
            const lineStart = text.lastIndexOf("\n", o.stmtRange.start - 1) + 1;
            const indent = /^[ \t]*/.exec(text.slice(lineStart, o.stmtRange.start))?.[0] ?? "    ";
            const msgId = Number(
                /^@(\d+)$/.exec((e.text ?? "").trim())?.[1] ??
                    /\(\s*(\d+)/.exec(text.slice(o.callRange!.start, o.callRange!.end))?.[1] ??
                    NaN,
            );
            if (Number.isFinite(msgId)) {
                const wrapped = serializeConditionalOption(e, msgId, e.condition!, indent);
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
    const added = editedOpts.filter((c) => isAllocatedNewOption(c) && !origById.has(c.id));
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

/**
 * Splice the node's OWN reply (NPC line) into an existing procedure when the edit ADDED one the source lacks.
 * A from-scratch scaffold emits an empty entry node; typing its NPC line allocates an `@N`, and once the node is
 * committed (no longer re-emitted whole) the `Reply(@N);` must be spliced into the existing procedure or the line
 * is dropped. Only the ADD case is handled here: a reply-text CHANGE where both sides already have a reply is a
 * `.msg` edit (the `@N` ref is unchanged), and REMOVING a reply is not a graph gesture. Inserted at the node's
 * body anchor, before options (the parser sets the anchor to the empty body for a reply-less procedure). Bails if
 * the node has no anchor (no editable body position captured).
 */
export function replyOps(edited: DialogState, orig: DialogState): SpliceOp[] {
    const id = atMsgId(edited.text);
    if (!Number.isFinite(id) || orig.text.trim() !== "") return []; // no reply to add, or one already exists
    const anchor = orig.insertAnchor;
    if (!anchor) return [];
    return [{ start: anchor.offset, end: anchor.offset, replacement: `\n${anchor.indent}${serializeSSLReply(id)}` }];
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
export function bundleNodeOps(text: string, edited: DialogState, orig: DialogState): SpliceOp[] {
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
            .filter((c): c is DialogChoice => c !== undefined && isAllocatedNewOption(c));
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
export function branchStructureOps(
    text: string,
    edited: DialogState,
    orig: DialogState,
    // The branch serializer for the ADD paths - `serializeSSLBranch` for `.ssl` (`if (c) then begin...end`),
    // `serializeTSSLBranch` for `.tssl` (`if (c) { ... }`). REMOVE is byte-range only and language-agnostic.
    serializeBranch: typeof serializeSSLBranch = serializeSSLBranch,
): SpliceOp[] {
    const ops: SpliceOp[] = [];
    const eb = edited.branches;
    const ob = orig.branches;
    if (!eb || !ob) return ops;

    const indent = "    "; // proc-body / function-body indent convention (4 spaces)

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
            .filter((c): c is DialogChoice => c !== undefined && isAllocatedNewOption(c) && Number.isFinite(msgIdOf(c)))
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
            const block = serializeBranch("if", b.condition, [], options, indent);
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
            const block = serializeBranch("else", undefined, [], options, indent);
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
export function branchConditionOps(_text: string, edited: DialogState, orig: DialogState): SpliceOp[] {
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
 * @throws if `edited.sourceLang !== "ssl"`.
 */
export function applySSLDialogEdits(originalText: string, edited: DialogModel, original: DialogModel): string {
    if (edited.sourceLang !== "ssl") {
        throw new Error("applySSLDialogEdits: only fallout-ssl source models are supported");
    }
    const origById = new Map(allStates(original).map((s) => [s.id, s]));
    const ops: SpliceOp[] = [];

    // RENAME: an edited node carrying `renamedFrom` is an existing node whose id changed. Rewrite its procedure
    // name token and the references nodeOps does NOT handle. Exclude it from the delete loop (its old id looks
    // "missing") and the add loop (its new id has no procRange).
    const renamedFromOf = new Map<string, string>(); // oldId -> newId
    for (const s of allStates(edited)) {
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
        for (const s of allStates(original)) {
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
        // Out-of-band entries (`force_dialog_start`/`start_dialog_at_node` in timers/map-enter handlers) live
        // outside talk_p_proc and have no model choice, so only the captured target span rewrites them. Their
        // spans are disjoint from every node procedure and from talk_p_proc's entry calls, so no op overlaps.
        for (const ob of original.outOfBandCalls ?? []) {
            if (ob.name === oldId)
                ops.push({ start: ob.targetRange.start, end: ob.targetRange.end, replacement: newId });
        }
    }

    for (const state of allStates(edited)) {
        // A renamed node's id is its NEW id; origById is keyed by ORIGINAL ids, so resolve via renamedFrom.
        // This lets nodeOps process the renamed node's own options against its original, AND lets a faithful
        // node referencing the renamed node retarget that option's targetRange to the new id.
        const orig = origById.get(state.renamedFrom ?? state.id);
        // Gate: structurally editable nodes only - plain-faithful or single-level if/else bundles.
        if (!orig || !(orig.faithful || orig.bundleFaithful)) continue;
        if (orig.bundleFaithful) {
            ops.push(...bundleNodeOps(originalText, state, orig));
        } else {
            ops.push(...nodeOps(originalText, state, orig, orig.insertAnchor, serializeSSLConditionalOption));
            // Add the node's own reply (NPC line) when the edit introduced one the procedure lacks - the
            // from-scratch scaffold path, where the entry node was emitted empty then given a line.
            ops.push(...replyOps(state, orig));
        }
        ops.push(...branchConditionOps(originalText, state, orig));
        ops.push(...branchStructureOps(originalText, state, orig));
    }

    // DELETE: an original node missing from the edited model -> remove its whole procedure span (and the
    // blank line it would leave). Inbound options were redirected to a terminal NMessage by the survivor
    // logic above (their target changed state -> exit in the edited model). A deleted node's procedure span
    // never overlaps another node's option slots (procedures are disjoint), and a redirected inbound option
    // lives in a DIFFERENT surviving node, so this deletion and that slot rewrite cannot overlap.
    const editedIds = new Set(allStates(edited).map((s) => s.id));
    for (const orig of allStates(original)) {
        // A renamed-away old id is absent from editedIds but is NOT a deletion (the RENAME block rewrote it).
        if (editedIds.has(orig.id) || !orig.procRange || renamedFromOf.has(orig.id)) continue;
        const start = orig.procRange.start;
        const nl = originalText.indexOf("\n", orig.procRange.end);
        const end = nl === -1 ? orig.procRange.end : nl + 1;
        ops.push({ start, end, replacement: "" });
        // Also splice out the node's forward declaration (`procedure <name>;`), or the file keeps an orphan
        // decl with no definition (disjoint from the body span above, so the two removals never overlap).
        if (orig.forwardDeclStmtRange) ops.push(removeStatementSplice(originalText, orig.forwardDeclStmtRange));
    }

    // INBOUND CALL REMOVAL: for each deleted node, remove any inbound `call <node>;` statements inside
    // other (surviving) nodes. A call choice on a surviving node has `callSites` set and targets the
    // deleted node - remove every top-level site (a node may call the deleted node more than once). Only
    // splice a site when `topLevel === true` - a call nested in an `if` cannot be removed without rewriting
    // the `if` body, and `eligibleToDelete` already refuses such nodes; this guard is defensive so the
    // splicer stays safe if ever called directly. Entry calls inside talk_p_proc for the
    // same deleted nodes are already handled by the ENTRY WIRING block (a deleted node is absent from
    // `editedById`, so its entry call is removed there); do NOT duplicate that here.
    for (const orig of allStates(original)) {
        if (editedIds.has(orig.id) || renamedFromOf.has(orig.id)) continue; // survives or renamed -> nothing to do
        for (const s of allStates(original)) {
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
    // The new nodes to emit (both branches below): local, never-spliced additions. `committed` marks a node
    // already spliced on a prior save (still without a procRange in the webview copy); excluding it stops its
    // procedure being re-emitted (duplicated) on later saves.
    const newNodes = allStates(edited).filter((s) => isLocalNewSSLNode(s) && !s.committed); // existing/derived/renamed/committed are not new nodes
    if (anchor !== undefined) {
        const blocks = newNodes.map((s) => serializeSSLProcedure(s, newNodeMsgIds(s), "    "));
        if (blocks.length > 0) {
            // Guarantee the spliced procedure starts on its own line. `newProcAnchor` normally sits at the start
            // of `procedure talk_p_proc` (preceded by a newline), but the webview model can carry a STALE anchor
            // between saves (its byte offsets are not re-projected until reconcile), so a length-changing prior
            // edit - e.g. a rename - can leave the char before the anchor mid-token (a preceding `end`). Inserting
            // there yields `endprocedure <name>`, which lexes as one identifier and drops the node on re-parse.
            // Prepend a newline whenever the preceding char is not already one.
            const needsLeadingNL = anchor > 0 && originalText[anchor - 1] !== "\n";
            ops.push({
                start: anchor,
                end: anchor,
                replacement: (needsLeadingNL ? "\n" : "") + blocks.map((b) => `${b}\n`).join(""),
            });
        }
    } else if (newNodes.length > 0) {
        // SCAFFOLD (from scratch): no `talk_p_proc`, so the ADD branch has no anchor. Emit the whole dialog
        // skeleton at EOF - forward decls, a talk_p_proc router calling the entry node(s), each new node's
        // procedure, and the Node998/Node999 support nodes. Mutually exclusive with the ADD branch (that runs
        // only when an anchor exists), so a node is never emitted twice, and the ENTRY WIRING below is a no-op
        // from scratch (entryCallAnchor is also undefined) - the router the scaffold writes IS the entry wiring.
        const procedures = newNodes.map((s) => serializeSSLProcedure(s, newNodeMsgIds(s), "    "));
        const entryIds = newNodes.filter((s) => s.isEntry).map((s) => s.id);
        // Emit a support node only if the file does not already declare or define it (matches both the forward
        // decl `procedure Node998;` and the definition `procedure Node998 begin`), so an existing Node998/Node999
        // is left byte-for-byte untouched.
        const emitSupport = ["Node998", "Node999"].filter(
            (id) => !new RegExp(String.raw`\bprocedure\s+${id}\b`).test(originalText),
        );
        const scaffold = serializeSSLDialogScaffold(
            entryIds,
            newNodes.map((s) => s.id),
            procedures,
            emitSupport,
        );
        // Separate the skeleton from any existing script body: nothing for an empty file, one newline when the
        // file already ends in one, else a blank line. Trailing newline so the saved file ends clean.
        const sep = originalText.length === 0 ? "" : originalText.endsWith("\n") ? "\n" : "\n\n";
        ops.push({ start: originalText.length, end: originalText.length, replacement: `${sep}${scaffold}\n` });
    }

    // ENSURE REFERENCED SUPPORT NODES EXIST: the Combat picker retargets an option to Node998 (and an option
    // may target Node999); the `NOption(msg, Node998)` dangles unless that procedure exists. When talk_p_proc is
    // already present (anchor defined, so the scaffold branch did not run and did not emit the pair), emit any
    // reserved terminal an edited option targets that the source lacks, with its default body, among the dialog
    // procedures at `anchor` - matching where a new node's procedure lands (see ADD above; same forward-decl
    // posture). No-op from scratch (the scaffold already emitted the conventional pair).
    if (anchor !== undefined) {
        const referenced = new Set<string>();
        for (const s of allStates(edited))
            for (const c of s.choices)
                if (c.target.kind === "state" && sslTerminalKind(c.target.stateId)) referenced.add(c.target.stateId);
        const missing = [...referenced].filter(
            (id) => !new RegExp(String.raw`\bprocedure\s+${id}\b`).test(originalText),
        );
        if (missing.length > 0) {
            // Same own-line guarantee as the ADD branch: a stale/abutting anchor must not glue the scaffolded
            // support procedure onto a preceding `end` (`endprocedure Node999`), which would drop it on re-parse.
            const needsLeadingNL = anchor > 0 && originalText[anchor - 1] !== "\n";
            ops.push({
                start: anchor,
                end: anchor,
                replacement:
                    (needsLeadingNL ? "\n" : "") + missing.map((id) => `${serializeSupportProcedure(id)}\n`).join(""),
            });
        }
    }

    // ENTRY WIRING: a node that became an entry -> splice `call <id>;` into talk_p_proc after the last
    // existing body statement; one that ceased being an entry (toggled off OR deleted) -> remove its
    // `call` statement. Overlap reasoning: entry-call removal spans live inside talk_p_proc, which is
    // disjoint from every node procedure and from any option slot; the addition is a zero-width splice
    // at entryCallAnchor (end of talk_p_proc's last body statement). A node that is both deleted AND was
    // an entry produces two ops: the procedure deletion (in its own procedure) and the entry-call removal
    // (in talk_p_proc) - the two procedures are disjoint so the ops cannot overlap.
    const originalEntries = new Set(original.entryIds);
    const editedById = new Map(allStates(edited).map((s) => [s.id, s]));
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
    // NOTE: the graph no longer exposes a "make entry" gesture (talk_p_proc dispatch is source-controlled), and
    // isEntry is otherwise only set by the parser, so in practice `added` is empty today. The branch is kept
    // (rather than deleted) because it is the correct write for isEntry, and the removal branch above is still
    // live: deleting an entry node must strip its talk_p_proc call.
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
    // TSSL is the same fallout-ssl family as SSL and is now structurally editable, so it must run these same
    // delete-safety checks - its writer (like SSL's) only removes TOP-LEVEL entry calls, so a tssl node with a
    // conditional / non-top-level entry call must NOT be deletable or it would leave a dangling reference. Gate
    // on renderFamily, not an exact "ssl". The D-family (d/td) defers to its own delete rules (return true).
    if (renderFamily(model.sourceLang) !== "fallout-ssl") return true;
    // A conditional entry (a `call` nested in an `if` inside talk_p_proc) cannot be removed without rewriting
    // the `if` - defer to condition editing.
    for (const ec of model.entryCalls ?? []) if (ec.name === stateId && !ec.topLevel) return false;
    // A `force_dialog_start`/`start_dialog_at_node` entry is in `entryIds` but has NO `entryCalls` entry - the
    // call lives in a non-dialog procedure (a timer/map-enter handler) the writer cannot reach. Removing the
    // node's procedure would leave that call dangling, so refuse (the entry toggle gates the same case).
    if ((model.entryIds ?? []).includes(stateId) && !(model.entryCalls ?? []).some((ec) => ec.name === stateId))
        return false;
    for (const s of allStates(model)) {
        for (const c of s.choices) {
            if (c.target.kind !== "state" || c.target.stateId !== stateId) continue;
            if (s.faithful !== true) return false; // inbound option/call in a node whose source we cannot rewrite
            // A call nested in an `if` (even in a faithful node) can't be removed without rewriting the `if`.
            if (c.callSites?.some((site) => site.topLevel !== true)) return false;
        }
    }
    return true;
}
