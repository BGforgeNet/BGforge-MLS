import { applyDDialogEdits } from "../../../shared/dialog-d-edit";
import { applySSLDialogEdits } from "../../../shared/dialog-ssl-edit";
import { applyTSSLDialogEdits } from "../../../shared/dialog-tssl-edit";
import { applyTDDialogEdits } from "../../../shared/dialog-td-edit";
import { allocateNodeIds, allocateOptionIds } from "../../../shared/dialog-ssl-ids";
import { allocateDFamilyIds } from "../../../shared/dialog-td-ids";
import { renderFamily, type DialogMessages, type DialogModel } from "../../../shared/dialog-model";

export interface DialogSourceEdit {
    /** Spliced source text, or null when the structure is unchanged (no source WorkspaceEdit needed). */
    newText: string | null;
    /** The edited model's messages with any newly-allocated ids merged in (for the .tra side-write). */
    messages: DialogMessages;
    /**
     * Item-id -> allocated `@N` text for each PENDING item (option choice or new node) that this edit just
     * committed to the source. Empty unless `newText` is non-null (nothing was spliced otherwise). The host
     * posts this back to the webview with the re-parse so it can remap the pending item's selection and any
     * open inline edit onto the item's canonical identity in the adopted model (see DialogGraph's
     * reselectAfterAdopt / remapChoiceId).
     */
    allocations: Record<string, string>;
}

/** A pending item that was just given an `@N` id: no source span of its own, but an `@N` text now. */
function isBareRef(text: string | undefined): boolean {
    return /^@\d+$/.test((text ?? "").trim());
}

/**
 * Compute the source-text edit for a webview model against the on-disk original, host-agnostic so it is
 * unit-testable without the vscode runtime. WeiDU D splices via applyDDialogEdits; faithful Fallout SSL nodes
 * splice via applySSLDialogEdits (non-faithful nodes stay read-only). New SSL content is allocated .msg ids
 * here (nodes first, then options) so the spliced source and the appended .msg entries agree.
 */
export function computeDialogSourceEdit(
    text: string,
    edited: DialogModel,
    original: DialogModel | null,
): DialogSourceEdit {
    let messages: DialogMessages = { ...edited.messages };
    // Id allocation mutates edited.messages (rather than only returning the new entries) because the SSL
    // splicer below reads each new reply/option's assigned `@id` off the model. Nodes are allocated before
    // options against the merged set, matching the original save() ordering, so a node's own new options
    // never collide with the node's own newly-assigned id.
    if (renderFamily(edited.sourceLang) === "fallout-ssl" && original) {
        // States whose SOURCE has no Reply statement AND into which the writer can actually splice one: the
        // `replyless` field (faithful + a node-level insertAnchor, set at parse) - the SAME signal the UI text
        // gate reads (textEditability -> npcLineAuthorable), so gate and writer agree by construction. A typed
        // literal on one of these mints an id and the writer splices `Reply(@N);` in; a bare empty-text check
        // would also mint ids for non-faithful / anchorless (TSSL) nodes that `replyOps` can never splice,
        // orphaning them in the .msg.
        const replyless = new Set(
            original.roots.flatMap((r) => r.states.filter((s) => s.replyless === true).map((s) => s.id)),
        );
        const node = allocateNodeIds(edited, original.messages ?? {}, replyless);
        const opt = allocateOptionIds(edited, { ...original.messages, ...node.newMessages });
        messages = { ...messages, ...node.newMessages, ...opt };
        edited.messages = messages;
    } else if (renderFamily(edited.sourceLang) === "weidu-d" && original) {
        // The WeiDU D family (`.d` and `.td`) mints `.tra` ids for its new say/reply text via the shared
        // D-family allocator - a single pass over the model (no node-then-option split, since a new state's say
        // and its options share one ascending id run).
        const created = allocateDFamilyIds(edited, original.messages ?? {});
        messages = { ...messages, ...created };
        edited.messages = messages;
    }
    // Dispatch by source language to the matching writer. A `switch` + `never` default (mirroring
    // `renderFamily`) keeps this exhaustive: a new `SourceLang` member without a dispatch arm is a compile
    // error, and an unhandled value at runtime fails loud rather than silently splicing as SSL. A from-scratch
    // model (`original === null`) has no on-disk source to splice against, so each writer no-ops to `text`.
    let spliced: string;
    switch (edited.sourceLang) {
        case "d":
            spliced = original ? applyDDialogEdits(text, edited, original) : text;
            break;
        case "td":
            spliced = original ? applyTDDialogEdits(text, edited, original) : text;
            break;
        case "tssl":
            spliced = original ? applyTSSLDialogEdits(text, edited, original) : text;
            break;
        case "ssl":
            spliced = original ? applySSLDialogEdits(text, edited, original) : text;
            break;
        default: {
            const unhandled: never = edited.sourceLang;
            throw new Error(`computeDialogSourceEdit: unhandled sourceLang ${String(unhandled)}`);
        }
    }
    const newText = spliced !== text ? spliced : null;
    // When something was spliced, report the pending items THIS edit just spliced, keyed by their (local)
    // model ids: the webview uses the map to remap selection and an open inline edit onto the items'
    // canonical identities when it adopts the re-parse. Empty when nothing was spliced.
    //
    // A NODE is reported even when its reply text is empty ("" rather than a bare `@N`): a from-scratch
    // scaffold emits an EMPTY entry node, and its selection still needs the remap. An OPTION reports its
    // `@N` (a terminal option carries no source span, so the allocated id is what identifies it across
    // the parse - see remapChoiceId).
    //
    // The "pending new item" marker is family-specific: SSL keys it on the absent `procRange`/`callRange` (its
    // source-span fields), the WeiDU D family (`.d`/`.td`) on the absent `sourceRange`. Using the wrong family's
    // marker would mis-report every existing item (D/TD states never carry a `procRange`, so the SSL marker
    // treats them all as new).
    const dFamily = renderFamily(edited.sourceLang) === "weidu-d";
    const allocations: Record<string, string> = {};
    if (newText !== null) {
        for (const state of edited.roots.flatMap((r) => r.states)) {
            const stateIsNew = dFamily ? state.sourceRange === undefined : state.procRange === undefined;
            if (stateIsNew && !state.derivedFrom) {
                allocations[state.id] = state.text;
            }
            for (const c of state.choices) {
                const choiceIsNew = dFamily
                    ? c.sourceRange === undefined
                    : c.callRange === undefined && c.stmtRange === undefined;
                if (choiceIsNew && isBareRef(c.text)) {
                    allocations[c.id] = c.text!;
                }
            }
        }
    }
    return { newText, messages, allocations };
}
