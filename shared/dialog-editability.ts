/**
 * Per-node editability for the dialog graph, in ONE place both the graph (DialogGraph.svelte) and the inspector
 * (Inspector.svelte) consume - so the two views can never disagree on whether a node may be edited.
 *
 * There is no longer a field-vs-structural split. Historically a node could be "field-editable" (retarget/text)
 * but not "structurally-editable" (add/remove/rename) while the TS-source writers were incomplete; that gap is
 * closed - TSSL reached structural parity with SSL, and TD nodes are gated on parser faithfulness - so field and
 * structural editability now coincide for every family and a single `nodeEditable` predicate replaces the former
 * duplicated structEditable/fieldEditable pair.
 */

import { renderFamily, type DialogModel, type DialogState } from "./dialog-model";
import { eligibleToDelete, isLocalNewSSLNode } from "./dialog-ssl-edit";
import { resrefName } from "./dialog-model-dlg";

/**
 * Whether a node may be edited (its field AND structural edits both round-trip to source).
 *  - A derived (CHAIN/INTERJECT/EXTEND) node is never editable - it has no own source span to splice into.
 *  - fallout-ssl family (SSL/TSSL): only a faithful flat node, a single-level if/else bundle, or a locally-new
 *    node (fully known by construction, not yet given a `faithful` flag by the parser).
 *  - weidu-d family (D/TD): every non-derived state is editable UNLESS the parser flagged it `faithful === false`
 *    (a body conditional the flat transition list can't round-trip - read-only). Keyed off the render family, not
 *    the model-level `editable` flag, which the two D-family variants set inconsistently (D true, TD false).
 */
export function nodeEditable(model: DialogModel, state: DialogState | null): state is DialogState {
    if (!state || state.derivedFrom) return false;
    // A DLG has no source text to splice, but it does not need any: the writer rebuilds the whole file from
    // the model, so every state is editable. What it may NOT do is change a state's number - see
    // `nodeRenamable` and `nodeDeletable`, which is where that boundary lives. The tree also holds the
    // dialogs this one hands off to, purely as context; the editor writes ONE file, so a state belonging to
    // another has nowhere for an edit to go. A state with no resref at all is one the user just added here.
    if (model.sourceLang === "dlg") {
        return state.dlgResref === undefined || state.dlgResref === resrefName(model.sourceName ?? "");
    }
    if (renderFamily(model.sourceLang) === "weidu-d") {
        return state.faithful !== false;
    }
    return state.faithful === true || state.bundleFaithful === true || isLocalNewSSLNode(state);
}

/**
 * Whether this model's format carries source spans at all.
 *
 * The pending/"unsaved draft" inference reads a missing span as "the user just added this node", which holds
 * only where spans otherwise exist. A compiled DLG has none for anything, so without this every node reads as
 * an unsaved draft - which is what a live drive showed. One definition because three consumers ask (the tree
 * builder, the graph card, and the flow-node projection) and they must not drift.
 */
export function hasSourceSpans(model: DialogModel): boolean {
    return model.sourceLang !== "dlg";
}

/**
 * Whether a node's own name may be changed. Everywhere but a compiled dialog this is just editability: a
 * state is identified by a label its author chose. A DLG state is identified by its POSITION, which other
 * dialogs and WeiDU mod scripts address by number - so it has no name to change, and renumbering it would
 * silently redirect references this editor cannot see.
 */
export function nodeRenamable(model: DialogModel, state: DialogState | null): state is DialogState {
    return nodeEditable(model, state) && model.sourceLang !== "dlg";
}

/**
 * Whether a node can be deleted from the graph right now: it must be editable AND every inbound reference must be
 * cleanable by the writer (`eligibleToDelete` - not a dialog entry, not reached by a non-removable call, no inbound
 * option in a node whose source can't be rewritten). D-family states pass `eligibleToDelete` by their own rules.
 */
export function nodeDeletable(model: DialogModel, state: DialogState | null): state is DialogState {
    // A DLG state is never deleted: removing one renumbers every state above it, and those numbers are
    // addresses other dialogs and mod scripts hold. It is detached instead - its record stays, its number
    // stays, and the replies that led to it stop doing so.
    if (model.sourceLang === "dlg") return false;
    return nodeEditable(model, state) && eligibleToDelete(model, state.id);
}
