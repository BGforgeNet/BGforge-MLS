import { applyDialogEdits } from "../../../shared/dialog-d-edit";
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
     * posts this back to the webview so it can mark those items `committed` and stop treating them as pending
     * new content - without which the next save re-splices them and duplicates the option. See panel.ts /
     * dialog-edit-ops.ts `applyReconcile`.
     */
    allocations: Record<string, string>;
}

/** A pending item that was just given an `@N` id: no source span of its own, but an `@N` text now. */
function isBareRef(text: string | undefined): boolean {
    return /^@\d+$/.test((text ?? "").trim());
}

/**
 * Compute the source-text edit for a webview model against the on-disk original, host-agnostic so it is
 * unit-testable without the vscode runtime. WeiDU D splices via applyDialogEdits; faithful Fallout SSL nodes
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
        const node = allocateNodeIds(edited, original.messages ?? {});
        const opt = allocateOptionIds(edited, { ...original.messages, ...node.newMessages });
        messages = { ...messages, ...node.newMessages, ...opt };
        edited.messages = messages;
    } else if (edited.sourceLang === "td" && original) {
        // TD (WeiDU D-family in TypeScript syntax) mints `.tra` ids for its new say/reply text via the shared
        // D-family allocator - a single pass over the model (no node-then-option split, since a new node's say
        // and its options share one ascending id run). Plain `.d` joins this branch in the next slice.
        const created = allocateDFamilyIds(edited, original.messages ?? {});
        messages = { ...messages, ...created };
        edited.messages = messages;
    }
    const spliced =
        edited.sourceLang === "d"
            ? applyDialogEdits(text, edited, original ?? undefined)
            : edited.sourceLang === "td"
              ? original
                  ? applyTDDialogEdits(text, edited, original)
                  : text
              : edited.sourceLang === "tssl"
                ? original
                    ? applyTSSLDialogEdits(text, edited, original)
                    : text
                : original
                  ? applySSLDialogEdits(text, edited, original)
                  : text;
    const newText = spliced !== text ? spliced : null;
    // When something was spliced, report the pending items THIS edit just spliced so the webview can mark them
    // committed. A pending item lacks a source span (option: no callRange/stmtRange; node: no procRange) and is
    // not yet committed. Already-`committed` items were reconciled by a PRIOR edit and are excluded - otherwise a
    // save that splices a NEW item alongside them (e.g. a second option on a just-created node) would re-report
    // the earlier ones every time. Empty when nothing was spliced.
    //
    // A NODE is reported even when its reply text is empty ("" rather than a bare `@N`): a from-scratch scaffold
    // emits an EMPTY entry node, and if it is not committed here it is re-emitted (a DUPLICATE `procedure`) on
    // every later save. It reports "" (commit-only - no `.msg` entry, which travels in `messages`, not here);
    // its reply, once typed, splices into the now-committed procedure. An OPTION still needs its `@N` (a terminal
    // option carries no source span, so the id is the only thing that distinguishes a committed one from new).
    const allocations: Record<string, string> = {};
    if (newText !== null) {
        for (const state of edited.roots.flatMap((r) => r.states)) {
            if (state.procRange === undefined && !state.derivedFrom && !state.committed) {
                allocations[state.id] = state.text;
            }
            for (const c of state.choices) {
                if (c.callRange === undefined && c.stmtRange === undefined && !c.committed && isBareRef(c.text)) {
                    allocations[c.id] = c.text!;
                }
            }
        }
    }
    return { newText, messages, allocations };
}
