/**
 * Pure message-handling kernel for App.svelte (the webview root).
 *
 * App holds {model, error, timedOut} as reactive $state and is otherwise DOM wiring; this
 * module holds the branching that decides what each host message does, so it is unit-tested
 * without a Svelte runtime (dialog-app-messages.test.ts). These are the fail-loud/never-hang
 * decisions: a model arrives and we render (clearing any error), an error arrives and we show
 * it (keeping the last model), a malformed message changes nothing, and "neither arrived yet"
 * is the timeout condition. `timedOut` itself is a timer concern that stays in the component.
 */

import type { DialogModel } from "../../../../shared/dialog-model";

export interface DialogView {
    model: DialogModel | null;
    error: string | null;
}

/** Next view-state for an incoming `window.message` payload; unchanged on anything unrecognized. */
export function reduceDialogView(prev: DialogView, data: unknown): DialogView {
    const msg = data as { type?: string; reparse?: boolean; model?: DialogModel; message?: string } | null;
    // A `reparse:true` post is the host adopting a self-edit's faithful parse: DialogGraph handles it directly
    // (it must preserve the current selection / an in-progress inline edit), so the root must NOT route it
    // through the model prop - that would reset the view. Only a plain `{type:"model"}` (initial load / external
    // text-side edit) updates the root's model.
    if (msg?.type === "model" && msg.model && !msg.reparse) return { model: msg.model, error: null };
    if (msg?.type === "error" && msg.message) return { model: prev.model, error: msg.message };
    return prev;
}

/** True when the host round-trip has produced neither a model nor an error - the spinner is stuck. */
export function shouldTimeOut(view: DialogView): boolean {
    return !view.model && !view.error;
}
