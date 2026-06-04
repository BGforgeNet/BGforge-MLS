<script lang="ts">
    import type { Diagnostic, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { ViewModel } from "../state/view-model";
    import VirtualList from "./VirtualList.svelte";
    import FormSection from "./FormSection.svelte";

    const { nodeId, bridge, vm, version, onadd, onedit, byNode }:
        { nodeId: NodeId; bridge: Bridge; vm: ViewModel; version: number; onadd: () => void;
          onedit: (id: string, v: number | string) => void;
          byNode: Map<string, Diagnostic[]> } = $props();
    // eslint-disable-next-line prefer-const -- reassigned via onselect callback
    let selected = $state<Row | undefined>();
</script>
<div class="master-detail">
    <div class="master">
        <div class="toolbar"><button onclick={onadd}>+ add</button></div>
        <VirtualList parentId={nodeId} {bridge} {version} selectedId={selected?.id}
                     onselect={(r) => (selected = r)} />
    </div>
    <div class="detail">
        {#if selected}
            <FormSection nodeId={selected.id} {bridge} {vm} {version} {onedit} {byNode} />
        {:else}
            <p class="placeholder">Select an entry.</p>
        {/if}
    </div>
</div>
