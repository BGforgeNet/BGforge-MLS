<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { RowActions } from "../state/structure-actions";

    const { acts, entryPath, bridge }:
        { acts: RowActions; entryPath: string[]; bridge: Bridge } = $props();
</script>
<span class="row-actions">
    <button disabled={!acts.insert} onclick={() => bridge.structureOp({ op: "insert", entryPath, position: "before" })}>+before</button>
    <button disabled={!acts.insert} onclick={() => bridge.structureOp({ op: "insert", entryPath, position: "after" })}>+after</button>
    <button disabled={!acts.duplicate} onclick={() => bridge.structureOp({ op: "duplicate", entryPath })}>dup</button>
    <button disabled={!acts.up} onclick={() => bridge.structureOp({ op: "reorder", entryPath, direction: "up" })}>^</button>
    <button disabled={!acts.down} onclick={() => bridge.structureOp({ op: "reorder", entryPath, direction: "down" })}>v</button>
    <button disabled={!acts.remove} onclick={() => bridge.structureOp({ op: "remove", entryPath })}>del</button>
</span>
