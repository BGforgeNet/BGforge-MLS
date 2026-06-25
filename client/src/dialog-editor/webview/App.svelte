<script lang="ts">
    import DialogGraph from "./DialogGraph.svelte";
    import type { DialogModel } from "../../../../shared/dialog-model";

    // Production webview root: the extension host posts a DialogModel; on each
    // message (initial load and live file edits) the model updates reactively and
    // DialogGraph re-lays-out. The harness mounts DialogGraph directly instead.
    let model = $state<DialogModel | null>(null);

    function onMessage(e: MessageEvent): void {
        const msg = e.data as { type?: string; model?: DialogModel };
        if (msg?.type === "model" && msg.model) {
            model = msg.model;
        }
    }

    $effect(() => {
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    });
</script>

{#if model}
    <DialogGraph {model} />
{:else}
    <div class="empty">Parsing dialog...</div>
{/if}

<style>
    .empty {
        color: #9aa0a6;
        font-size: 12px;
        padding: 16px;
    }
</style>
