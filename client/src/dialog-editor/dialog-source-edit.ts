import { applyDialogEdits } from "../../../shared/dialog-d-edit";
import { applySSLDialogEdits } from "../../../shared/dialog-ssl-edit";
import { allocateNodeIds, allocateOptionIds } from "../../../shared/dialog-ssl-ids";
import type { DialogModel } from "../../../shared/dialog-model";

/** Resolved translation-string entries keyed by id (the .msg/.tra id space both formats share). */
export type DialogMessages = Record<string, string>;

export interface DialogSourceEdit {
    /** Spliced source text, or null when the structure is unchanged (no source WorkspaceEdit needed). */
    newText: string | null;
    /** The edited model's messages with any newly-allocated ids merged in (for the .tra side-write). */
    messages: DialogMessages;
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
    return { newText: spliced !== text ? spliced : null, messages };
}
