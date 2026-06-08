<script lang="ts">
    import type { NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { visibleRange } from "../state/virtual-window";
    import { rowActions, type SectionCaps } from "../state/structure-actions";
    import Field from "./Field.svelte";
    import RowActions from "./RowActions.svelte";

    const { parentId, caps, bridge, version, selection, onedit, showOffsets = false }:
        { parentId: NodeId; caps: SectionCaps; bridge: Bridge; version: number;
          selection: NodeId | undefined; onedit: (id: string, v: number | string) => void;
          showOffsets?: boolean } = $props();

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
    // Guards applying the host selection at most once per version, so plain scrolling never overrides a user click.
    let appliedSelectionVersion = -1;

    const range = $derived(visibleRange({ scrollTop, viewportHeight, rowHeight, overscan, total }));

    // Switching sections is a full reset: a different collection, no carried-over active row.
    $effect(() => {
        void parentId;
        rowsByIndex = new Map();
        activeIndex = undefined;
    });

    // A version bump (mutation/edit) clears the per-index row map so the next fetch repopulates from a fresh model.
    // The active row is re-derived from the host selection once the new rows load (below), not dropped here.
    $effect(() => {
        void version;
        rowsByIndex = new Map();
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
            // After a mutation/edit the host returns the NodeId to keep active; resolve it to a row index once this
            // version's rows are loaded. The new/moved/edited entry re-opens instead of the list collapsing.
            if (appliedSelectionVersion !== version) {
                appliedSelectionVersion = version;
                let found: number | undefined;
                if (selection !== undefined) {
                    next.forEach((r, idx) => {
                        if (r.id === selection) found = idx;
                    });
                }
                activeIndex = found;
            }
        });
        return () => { cancelled = true; };
    });

</script>
<div class="inline-list-toolbar">
    {#if caps.canAdd}<button onclick={() => bridge.structureOp({ op: "add", sectionId: parentId })}>+ add</button>{/if}
</div>
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
                {@const acts = rowActions(idx, total, caps)}
                <div class="vrow inline" class:selected={idx === activeIndex}
                     style="position:absolute;top:{idx * rowHeight}px;height:{rowHeight}px;left:0;right:0"
                     onclick={() => (activeIndex = idx)} role="button" tabindex="0"
                     onkeydown={(e) => { if (e.key === "Enter") activeIndex = idx; }}>
                    <!-- Every inline row renders its editable control (a variable is a single scalar - there is
                         no "detail" to open, so requiring a click to reveal an input just hides the value behind
                         an interaction). Selecting a row (click) reveals its structure-op actions. -->
                    <Field {row} {onedit} {showOffsets} />
                    {#if idx === activeIndex}
                        <RowActions {acts} entryId={row.id} {bridge} compact={true} />
                    {/if}
                </div>
            {/if}
        {/each}
    </div>
</div>
