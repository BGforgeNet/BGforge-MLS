/**
 * Pure decision kernel for the host's re-parse messages (DialogGraph's `onReparse` listener).
 *
 * After the host splices a self-edit into the source it posts the faithful parse back (`reparse: true`,
 * stamped with the emit's seq). The branching lives here, unit-tested without a Svelte runtime
 * (dialog-reparse-decision.test.ts) - the same split app-messages.ts makes for the root:
 *  - a non-reparse or malformed message is not this listener's business (App routes plain models);
 *  - a stale parse (seq behind the latest emit) is dropped - a newer optimistic edit supersedes it,
 *    and adopting it would clobber what the user just typed;
 *  - otherwise the faithful parse is adopted wholesale. An open inline edit does NOT block the adopt:
 *    the listener carries the input's live draft and caret across the model replacement as a small
 *    overlay (see adoptModel), which replaced the old "reconcile the optimistic model in place"
 *    branch and the allocation-stamping machinery it needed.
 */

import type { DialogModel } from "../../../../shared/dialog-model";

export interface ReparseMessage {
    type?: string;
    reparse?: boolean;
    model?: DialogModel;
    seq?: number;
    allocations?: Record<string, string>;
    messages?: Record<string, string>;
}

export type ReparseDecision =
    | { kind: "ignore" }
    | { kind: "adopt"; model: DialogModel; allocations?: Record<string, string>; messages?: Record<string, string> };

/** Classify one incoming `window.message` payload for the re-parse listener. */
export function decideReparse(data: ReparseMessage | null | undefined, localSeq: number): ReparseDecision {
    if (data?.type !== "model" || !data.reparse || !data.model) return { kind: "ignore" };
    if (data.seq !== localSeq) return { kind: "ignore" }; // stale: a newer optimistic edit already superseded it
    return { kind: "adopt", model: data.model, allocations: data.allocations, messages: data.messages };
}
