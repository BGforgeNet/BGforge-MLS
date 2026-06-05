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

    // Primary label: summary (e.g. opcode name "State: Invisibility") when provided by the core,
    // otherwise the positional name ("Effect 1"). The index is rendered separately as a muted prefix.
    function rowLabel(row: Row): string { return row.summary ?? row.name; }
</script>
<div class="vlist"
     bind:clientHeight={viewportHeight} onscroll={(e) => (scrollTop = (e.target as HTMLElement).scrollTop)}>
    <!-- The interpolated style= attributes below are CSP-safe: Svelte compiles a `style="...{expr}..."`
         attribute to element.style.cssText (a CSSOM mutation), which CSP does not govern. Only STATIC
         template style attributes are parsed from HTML and subject to the nonce CSP - that is why the root
         height/overflow lives on the .vlist class instead. The render-itm/spl harness CSP gate renders these
         very rows with zero violations. -->
    <div style="height:{total * rowHeight}px;position:relative">
        {#each Array.from({ length: range.end - range.start }, (_, k) => range.start + k) as idx (idx)}
            {@const row = rowsByIndex.get(idx)}
            {#if row}
                <div class="vrow" class:selected={row.id === selectedId}
                     style="position:absolute;top:{idx * rowHeight}px;height:{rowHeight}px;left:0;right:0"
                     onclick={() => onselect(row, idx)} role="button" tabindex="0"
                     onkeydown={(e) => { if (e.key === "Enter") onselect(row, idx); }}>
                    <span class="vrow-index">{idx}</span><span class="vrow-label">{rowLabel(row)}</span>
                </div>
            {/if}
        {/each}
    </div>
</div>
