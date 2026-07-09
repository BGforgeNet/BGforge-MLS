/**
 * TSSL surgical source editor: splices field edits back into the `.tssl` TypeScript SOURCE using the byte
 * ranges the source parser recorded (ranges into the .tssl, not generated SSL). Mirrors `applySSLDialogEdits`
 * but over TS syntax; because a TSSL option call is byte-identical to SSL (`NOption(101, Node002, 4)`), the
 * per-field token splices (retarget, ...) are the same - only the node wrapper and block syntax differ, which
 * field edits do not touch. Structural edits: option add/remove, node add/remove/rename, and full BUNDLE-node
 * editing (per-branch option add/remove/retarget/reorder, branch-condition edits, add/remove if/else). Bundle
 * editing reuses the shared SSL bundle writer (`bundleNodeOps`/`branchConditionOps`/`branchStructureOps`) - all
 * byte-range + shared SSL call syntax - with `serializeTSSLBranch` supplying the TS `{ }` block ADD syntax.
 */

import { applySplices, type SpliceOp } from "./dialog-splice";
import { allStates, lineIndentAt, removeLineSplice } from "./dialog-edit-common";
import {
    branchConditionOps,
    branchStructureOps,
    bundleNodeOps,
    isLocalNewSSLNode,
    nodeOps,
    replyOps,
} from "./dialog-ssl-edit";
import { serializeTSSLBranch, serializeTSSLProcedure } from "./dialog-tssl-serialize";
import type { DialogModel, DialogState } from "./dialog-model";

/**
 * The reply-only add-option anchor for a TSSL node: the offset just before the function's closing brace, at the
 * body indent. `nodeOps` uses this only when a new option lands on a node with NO surviving option (a say-only
 * node); a node with a surviving option anchors the new option after it instead. This is TSSL's analogue of the
 * SSL `insertAnchor` the parser records - TSSL's node has a `}` close where SSL's has its captured anchor.
 */
function tsslBodyAnchor(text: string, orig: DialogState): { offset: number; indent: string } | undefined {
    if (!orig.procRange) return undefined;
    const close = text.lastIndexOf("}", orig.procRange.end - 1);
    if (close <= orig.procRange.start) return undefined;
    let bodyStart = orig.procRange.start;
    while (bodyStart < close && text[bodyStart] !== "\n") bodyStart++;
    return { offset: close, indent: lineIndentAt(text, bodyStart + 1) || "    " };
}

/**
 * Compute the `.tssl` source with the model's surgical edits applied: option field edits (retarget, reaction,
 * low-INT, terminal flip, condition), option reorder/add/remove, node add/remove/rename, and full bundle-node
 * branch editing (routed through the shared SSL bundle writer). Returns the text unchanged when nothing changed.
 *
 * @throws if `edited.sourceLang !== "tssl"` - a D/SSL/TD model must not be serialized as TSSL.
 */
export function applyTSSLDialogEdits(originalText: string, edited: DialogModel, original: DialogModel): string {
    if (edited.sourceLang !== "tssl") {
        throw new Error("applyTSSLDialogEdits: only tssl source models are supported");
    }
    const origStateById = new Map(allStates(original).map((s) => [s.id, s]));
    const ops: SpliceOp[] = [];

    // Per-node OPTION editing (remove / retarget / reorder / terminal-flip / condition edit-text + unwrap /
    // add-option) routes through the SHARED fallout-ssl-family engine `nodeOps` - byte-for-byte the path
    // applySSLDialogEdits takes - so the two source variants of the family cannot drift on these operations (the
    // recurring "TSSL parity" defect this consolidation retires). The engine emits the option/reply call syntax
    // TSSL and SSL share verbatim. Two per-variant inputs only: the reply-only add-option anchor (`tsslBodyAnchor`
    // - TSSL's `}` close where SSL has its parser-captured `insertAnchor`) and the branch-ADD serializer
    // (`serializeTSSLBranch`). No conditional-option serializer is injected, so the flat->conditional WRAP is a
    // no-op here (TSSL has no such serializer yet); condition edit-text and unwrap still work (shared bare call).
    // Bundle nodes go through the shared bundle writer; the branch condition/structure ops are a no-op on a
    // non-bundle node. A renamed node resolves to its original via `renamedFrom` so its options still diff.
    for (const state of allStates(edited)) {
        const orig = origStateById.get(state.renamedFrom ?? state.id);
        if (!orig) continue;
        if (orig.bundleFaithful) {
            ops.push(...bundleNodeOps(originalText, state, orig));
        } else {
            ops.push(...nodeOps(originalText, state, orig, tsslBodyAnchor(originalText, orig)));
            ops.push(...replyOps(state, orig));
        }
        ops.push(...branchConditionOps(originalText, state, orig));
        ops.push(...branchStructureOps(originalText, state, orig, serializeTSSLBranch));
    }

    // RENAME node: a node whose id changed carries `renamedFrom` (set by ops.renameState). Rewrite its
    // function-name token and every entry call / out-of-band call targeting the OLD id. Inbound OPTION targets
    // were moved by the model's retarget (handled inside `nodeOps` via survivorReplacement), so they are not
    // touched here - the double-splice guard, mirroring applySSLDialogEdits. The old id is also excluded from the
    // DELETE loop below (a renamed-away id is absent from editedStateIds but is NOT a deletion).
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
    const editedStateIds = new Set(allStates(edited).map((s) => s.id));
    // Structural: DELETE node - an original node absent from the edited model -> splice out its whole function
    // span plus the trailing newline it would leave. Disjoint from every option splice (functions do not
    // overlap, and an inbound option that flipped to a terminal lives in a DIFFERENT surviving node). Mirrors
    // `applySSLDialogEdits`' DELETE case; renamed-away nodes are excluded once rename lands.
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
    // Structural: ADD node - a locally-new node (no procRange, not derived/renamed) -> serialize a whole
    // `function <id>() { ... }` and insert it just before the `talk_p_proc` entry router, mirroring
    // `applySSLDialogEdits`' add-node (which anchors before talk_p_proc). @N ids are already allocated
    // upstream (renderFamily=fallout-ssl gate). A file with no entry router is a from-scratch scaffold, out
    // of scope here. Disjoint from every option/node splice (the anchor is a zero-width insert at talk_p_proc).
    // Anchor a brand-new node's `function` just before the entry router, using the offset the parser recorded
    // (`newProcAnchor` = `fn.getStart()` of talk_p_proc) instead of a raw text search - the recorded anchor is
    // exact and cannot match `talk_p_proc` inside a comment or string. Absent only for a from-scratch scaffold
    // with no router (out of scope here). Mirrors applySSLDialogEdits' `edited.newProcAnchor ?? original...`.
    const talkAnchor = edited.newProcAnchor ?? original.newProcAnchor;
    if (talkAnchor !== undefined) {
        for (const state of allStates(edited)) {
            if (!isLocalNewSSLNode(state) || state.committed) continue;
            ops.push({ start: talkAnchor, end: talkAnchor, replacement: `${serializeTSSLProcedure(state)}\n\n` });
        }
    }
    return applySplices(originalText, ops);
}
