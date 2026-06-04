<script lang="ts">
    import type { NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { ViewModel } from "../state/view-model";
    import Field from "./Field.svelte";
    import Self from "./FormSection.svelte";

    const { nodeId, bridge, vm, version, onedit }:
        { nodeId: NodeId; bridge: Bridge; vm: ViewModel; version: number;
          onedit: (id: string, v: number | string) => void } = $props();

    let rows = $state<Row[]>([]);
    $effect(() => {
        void version; // dependency: a bump re-fetches after the cache is cleared
        let cancelled = false;
        // Form groups are small; 1000 covers every real record. A windowed fetch for pathological cases is deferred.
        bridge.requestChildren(nodeId, 0, 1000).then((w) => { if (!cancelled) rows = w.rows; });
        return () => { cancelled = true; };
    });
</script>
<div class="form">
    {#each rows as row (row.id)}
        {#if row.kind === "group"}
            <div class="subgroup">
                <button class="caret" class:open={vm.isExpanded(row.id)}
                        onclick={() => vm.toggleExpanded(row.id)}>{row.name}</button>
                {#if vm.isExpanded(row.id)}
                    <Self nodeId={row.id} {bridge} {vm} {version} {onedit} />
                {/if}
            </div>
        {:else}
            <Field {row} {onedit} />
        {/if}
    {/each}
</div>
