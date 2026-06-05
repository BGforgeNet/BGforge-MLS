<script lang="ts">
    import type { NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { visibleRange } from "../state/virtual-window";
    import { rowActions, type SectionCaps } from "../state/structure-actions";
    import Field from "./Field.svelte";

    const { parentId, title, caps, bridge, version, onedit }:
        { parentId: NodeId; title: string; caps: SectionCaps; bridge: Bridge; version: number;
          onedit: (id: string, v: number | string) => void } = $props();

    // Tall enough to contain the active row's inline Field control plus the action bar without overflowing into the
    // next absolutely-positioned row. Inactive rows show a single label/value line and have headroom to spare.
    const rowHeight = 34;
    const overscan = 6;
    // eslint-disable-next-line prefer-const -- reassigned via bind:clientHeight in template
    let viewportHeight = $state(400);
    // eslint-disable-next-line prefer-const -- reassigned via onscroll handler in template
    let scrollTop = $state(0);
    let total = $state(0);
    let rowsByIndex = $state<Map<number, Row>>(new Map());
    // eslint-disable-next-line prefer-const -- reassigned via onclick/onkeydown in template
    let activeIndex = $state<number | undefined>();

    const range = $derived(visibleRange({ scrollTop, viewportHeight, rowHeight, overscan, total }));

    // A version bump clears the per-index row map so the next fetch repopulates from a fresh model, and drops the
    // active selection: after a structural op the index no longer maps to the same entry (a remove shifts everything
    // up, an add lands elsewhere), so keeping it open would expand the wrong row.
    $effect(() => {
        void version;
        rowsByIndex = new Map();
        activeIndex = undefined;
    });

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

    const entryPath = (row: Row): string[] => [title, row.name];
</script>
<div class="inline-list-toolbar">
    {#if caps.canAdd}<button onclick={() => bridge.structureOp({ op: "add", namePath: [title] })}>+ add</button>{/if}
</div>
<div class="vlist" style="height:100%;overflow:auto"
     bind:clientHeight={viewportHeight} onscroll={(e) => (scrollTop = (e.target as HTMLElement).scrollTop)}>
    <div style="height:{total * rowHeight}px;position:relative">
        {#each Array.from({ length: range.end - range.start }, (_, k) => range.start + k) as idx (idx)}
            {@const row = rowsByIndex.get(idx)}
            {#if row}
                {@const acts = rowActions(idx, total, caps)}
                <div class="vrow inline" class:selected={idx === activeIndex}
                     style="position:absolute;top:{idx * rowHeight}px;height:{rowHeight}px;left:0;right:0"
                     onclick={() => (activeIndex = idx)} role="button" tabindex="0"
                     onkeydown={(e) => { if (e.key === "Enter") activeIndex = idx; }}>
                    {#if idx === activeIndex}
                        <Field {row} {onedit} />
                        <span class="row-actions">
                            <button disabled={!acts.insert} onclick={() => bridge.structureOp({ op: "insert", entryPath: entryPath(row), position: "before" })}>+before</button>
                            <button disabled={!acts.insert} onclick={() => bridge.structureOp({ op: "insert", entryPath: entryPath(row), position: "after" })}>+after</button>
                            <button disabled={!acts.duplicate} onclick={() => bridge.structureOp({ op: "duplicate", entryPath: entryPath(row) })}>dup</button>
                            <button disabled={!acts.up} onclick={() => bridge.structureOp({ op: "reorder", entryPath: entryPath(row), direction: "up" })}>^</button>
                            <button disabled={!acts.down} onclick={() => bridge.structureOp({ op: "reorder", entryPath: entryPath(row), direction: "down" })}>v</button>
                            <button disabled={!acts.remove} onclick={() => bridge.structureOp({ op: "remove", entryPath: entryPath(row) })}>del</button>
                        </span>
                    {:else}
                        <span class="label">{row.name}</span> <span class="value">{row.displayValue}</span>
                    {/if}
                </div>
            {/if}
        {/each}
    </div>
</div>
