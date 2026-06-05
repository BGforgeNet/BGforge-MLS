<script lang="ts">
    import type { NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { visibleRange } from "../state/virtual-window";

    const { parentId, bridge, version, selectedId, onselect }:
        { parentId: NodeId; bridge: Bridge; version: number; selectedId: NodeId | undefined;
          onselect: (row: Row, index: number) => void } = $props();

    const rowHeight = 22;
    const overscan = 6;
    // eslint-disable-next-line prefer-const -- reassigned via bind:clientHeight in template
    let viewportHeight = $state(400);
    // eslint-disable-next-line prefer-const -- reassigned via onscroll handler in template
    let scrollTop = $state(0);
    let total = $state(0);
    let rowsByIndex = $state<Map<number, Row>>(new Map());

    const range = $derived(visibleRange({ scrollTop, viewportHeight, rowHeight, overscan, total }));

    // A version bump clears the per-index row map so the next fetch repopulates from a fresh model.
    $effect(() => { void version; rowsByIndex = new Map(); });

    $effect(() => {
        void version; // re-fetch the visible window after a mutation/reset
        const { start, end } = range;
        let cancelled = false;
        bridge.requestChildren(parentId, start, end).then((w) => {
            if (cancelled) return;
            total = w.total;
            const next = new Map(rowsByIndex);
            w.rows.forEach((r, i) => next.set(start + i, r));
            rowsByIndex = next;
        });
        return () => { cancelled = true; };
    });

    function summary(row: Row): string { return row.displayValue ? `${row.name}  ${row.displayValue}` : row.name; }
</script>
<div class="vlist" style="height:100%;overflow:auto"
     bind:clientHeight={viewportHeight} onscroll={(e) => (scrollTop = (e.target as HTMLElement).scrollTop)}>
    <div style="height:{total * rowHeight}px;position:relative">
        {#each Array.from({ length: range.end - range.start }, (_, k) => range.start + k) as idx (idx)}
            {@const row = rowsByIndex.get(idx)}
            {#if row}
                <div class="vrow" class:selected={row.id === selectedId}
                     style="position:absolute;top:{idx * rowHeight}px;height:{rowHeight}px;left:0;right:0"
                     onclick={() => onselect(row, idx)} role="button" tabindex="0"
                     onkeydown={(e) => { if (e.key === "Enter") onselect(row, idx); }}>
                    {idx}  {summary(row)}
                </div>
            {/if}
        {/each}
    </div>
</div>
