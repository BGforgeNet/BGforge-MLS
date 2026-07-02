<script lang="ts">
    import type { DialogReaction } from "../../../../shared/dialog-model";

    // An SSL option's reaction (from the NOption/GOption/BOption macro prefix) as a colored letter chip,
    // plus the low-INT (*LowOption) marker. Shared by the graph card (Node.svelte) and the tree view
    // (Tree.svelte) so option reactions render identically in both. The letter / "INT-" text carries the
    // meaning, so color is never the sole cue. Absent reaction (D transitions) renders no chip.
    let { reaction, lowIq = false }: { reaction?: DialogReaction; lowIq?: boolean } = $props();

    function info(r: DialogReaction): { letter: string; title: string; cls: string } {
        if (r === "good") return { letter: "G", title: "Good reaction (GOption)", cls: "rx-good" };
        if (r === "bad") return { letter: "B", title: "Bad reaction (BOption)", cls: "rx-bad" };
        return { letter: "N", title: "Neutral reaction (NOption)", cls: "rx-neutral" };
    }
    const rx = $derived(reaction ? info(reaction) : null);
</script>

{#if rx}<span class="rx {rx.cls}" title={rx.title}>{rx.letter}</span>{/if}
{#if lowIq}<span class="iq" title="Low-INT only: shown to a low-intelligence PC (a *LowOption macro)">INT-</span>{/if}

<style>
    .rx {
        flex: 0 0 auto;
        border-radius: 3px;
        border: 1px solid;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    .rx-good {
        color: #86efac;
        background: #16281b;
        border-color: #22c55e;
    }
    .rx-neutral {
        color: #cbd5e1;
        background: #2b303a;
        border-color: #4b5563;
    }
    .rx-bad {
        color: #fca5a5;
        background: #2a1717;
        border-color: #b91c1c;
    }
    /* Low-INT-only option marker: purple, distinct from every reaction color. */
    .iq {
        flex: 0 0 auto;
        color: #d8b4fe;
        background: #241730;
        border: 1px solid #7e22ce;
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
</style>
