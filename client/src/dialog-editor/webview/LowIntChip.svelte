<script lang="ts">
    // The low-INT-only option marker (*LowOption macro): a small purple "INT-" chip. Shared by the graph
    // card (Node.svelte) and the tree view (Tree.svelte) so it renders identically in both. The option's
    // reaction (good/bad/neutral) is NOT shown here - it is carried by the option text colour (green / red /
    // quiet grey) in both views, so the former N/B/G letter chip would only duplicate it. Absent low-INT
    // flag renders nothing.
    let { lowIq = false }: { lowIq?: boolean } = $props();
</script>

{#if lowIq}<span class="iq" title="Low-INT only: shown to a low-intelligence PC (a *LowOption macro)">INT-</span>{/if}

<style>
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
