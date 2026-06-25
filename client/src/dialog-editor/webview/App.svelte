<script lang="ts">
    import DialogGraph from "./DialogGraph.svelte";
    import type { DialogModel } from "../../../../shared/dialog-model";
    import { hasHost } from "./host";

    // Production webview root: the extension host posts a DialogModel; on each
    // message (initial load and live file edits) the model updates reactively and
    // DialogGraph re-lays-out. The harness mounts DialogGraph directly instead.
    let model = $state<DialogModel | null>(null);
    let error = $state<string | null>(null);
    let timedOut = $state(false);

    function onMessage(e: MessageEvent): void {
        const msg = e.data as { type?: string; model?: DialogModel; message?: string };
        if (msg?.type === "model" && msg.model) {
            model = msg.model;
            error = null;
            timedOut = false;
        } else if (msg?.type === "error" && msg.message) {
            error = msg.message;
        }
    }

    $effect(() => {
        window.addEventListener("message", onMessage);
        // If neither a model nor an error arrives, the host->server round-trip stalled
        // (or the "ready" handshake never reached the host). Surface it rather than sit
        // on "Parsing dialog..." forever.
        const t = setTimeout(() => {
            if (!model && !error) timedOut = true;
        }, 8000);
        return () => {
            window.removeEventListener("message", onMessage);
            clearTimeout(t);
        };
    });
</script>

{#if model}
    <DialogGraph {model} />
{:else if error}
    <div class="empty err">{error}</div>
{:else if timedOut}
    <div class="empty err">
        No response from the language server within 8s - the dialog parse did not return.
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
        color: #9aa0a6;
        font-size: 12px;
        padding: 16px;
    }
    .empty.err {
        color: #fca5a5;
        max-width: 480px;
        line-height: 1.5;
    }
</style>
