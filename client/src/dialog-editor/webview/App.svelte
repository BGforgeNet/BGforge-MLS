<script lang="ts">
    import DialogGraph from "./DialogGraph.svelte";
    import type { DialogModel } from "../../../../shared/dialog-model";
    import { hasHost } from "./host";
    import { reduceDialogView, shouldTimeOut } from "./app-messages";
    import { DEFAULT_INIT_TIMEOUT_MS, installInitTimeout, isHostMessage } from "../../webview-utils";

    // Production webview root: the extension host posts a DialogModel; on each
    // message (initial load and live file edits) the model updates reactively and
    // DialogGraph re-lays-out. The harness mounts DialogGraph directly instead.
    // Raw: the parsed dialog arrives whole and is replaced whole. DialogGraph clones it into its own
    // deep edit model, which is the only thing anything writes into.
    let model = $state.raw<DialogModel | null>(null);
    let error = $state<string | null>(null);
    let timedOut = $state(false);

    function onMessage(e: MessageEvent): void {
        if (!isHostMessage(e)) return;
        // Branching logic (and its tests) lives in app-messages.ts; here we only apply the
        // result to reactive state. A fresh model clears any stale timeout.
        const next = reduceDialogView({ model, error }, e.data);
        model = next.model;
        error = next.error;
        if (next.model) timedOut = false;
    }

    $effect(() => {
        window.addEventListener("message", onMessage);
        // If neither a model nor an error arrives, the host->server round-trip stalled
        // (or the "ready" handshake never reached the host). Surface it rather than sit
        // on "Parsing dialog..." forever. The timer mechanics are shared with the binary
        // editor's App.svelte via installInitTimeout (webview-utils.ts).
        const initWait = installInitTimeout({
            ms: DEFAULT_INIT_TIMEOUT_MS,
            isResolved: () => !shouldTimeOut({ model, error }),
            onTimeout: () => {
                timedOut = true;
            },
        });
        return () => {
            window.removeEventListener("message", onMessage);
            initWait.cancel();
        };
    });
</script>

{#if model}
    <DialogGraph {model} />
{:else if error}
    <div class="empty err">{error}</div>
{:else if timedOut}
    <div class="empty err">
        No response from the language server within {DEFAULT_INIT_TIMEOUT_MS / 1000}s - the dialog parse did not return.
        {#if !hasHost()}
            The webview could not connect to the editor host (acquireVsCodeApi unavailable).
        {/if}
        Try reopening the dialog editor, and check the "BGforge MLS" output channel for a parse error.
    </div>
{:else}
    <div class="empty">Parsing dialog...</div>
{/if}

<style>
    .empty {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        padding: 16px;
    }
    .empty.err {
        color: var(--vscode-errorForeground);
        max-width: 480px;
        line-height: 1.5;
    }
</style>
