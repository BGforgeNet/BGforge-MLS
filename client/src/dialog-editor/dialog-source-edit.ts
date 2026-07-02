import { applyDialogEdits } from "../../../shared/dialog-d-edit";
import { applySSLDialogEdits } from "../../../shared/dialog-ssl-edit";
import { allocateNodeIds, allocateOptionIds } from "../../../shared/dialog-ssl-ids";
import type { DialogMessages, DialogModel } from "../../../shared/dialog-model";

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
    if (edited.format === "fallout-ssl" && original) {
        const node = allocateNodeIds(edited, original.messages ?? {});
        const opt = allocateOptionIds(edited, { ...original.messages, ...node.newMessages });
        messages = { ...messages, ...node.newMessages, ...opt };
        edited.messages = messages;
    }
    const spliced =
        edited.format === "weidu-d"
            ? applyDialogEdits(text, edited, original ?? undefined)
            : original
              ? applySSLDialogEdits(text, edited, original)
              : text;
    const newText = spliced !== text ? spliced : null;
    // When something was spliced, report the pending items that just gained an `@N` id so the webview can mark
    // them committed. A pending item is one still lacking a source span (option: no callRange/stmtRange; node:
    // no procRange) but carrying an `@N` text after allocation above. Existing options carry a stmtRange, so
    // they are excluded. Empty when nothing was spliced (no new content to reconcile).
    const allocations: Record<string, string> = {};
    if (newText !== null) {
        for (const state of edited.roots.flatMap((r) => r.states)) {
            if (state.procRange === undefined && !state.derivedFrom && isBareRef(state.text)) {
                allocations[state.id] = state.text;
            }
            for (const c of state.choices) {
                if (c.callRange === undefined && c.stmtRange === undefined && isBareRef(c.text)) {
                    allocations[c.id] = c.text!;
                }
            }
        }
    }
    return { newText, messages, allocations };
}
