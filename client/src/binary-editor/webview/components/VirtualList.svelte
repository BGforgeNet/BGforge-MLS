<script lang="ts">
    import type { NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { visibleRange } from "../state/virtual-window";

    // When `rows` is provided (filtered mode), VirtualList renders that fixed array directly
    // without fetching its own window. This keeps the virtualized fetch path for large unfiltered
    // lists while letting ListSection supply a pre-filtered array when a query is active.
    const { parentId, bridge, version, selectedId, onselect, rows: fixedRows, scrollTo }:
        { parentId: NodeId; bridge: Bridge; version: number; selectedId: NodeId | undefined;
          onselect: (row: Row, index: number) => void; rows?: Row[];
          // Token-gated scroll request: when `token` changes (a host-driven selection like a cross-record jump),
          // scroll `index` into view. Token-gated so the same index re-scrolls on a fresh jump and a plain user
          // click (which does not bump the token) never yanks the list. */
          scrollTo?: { index: number; token: number } } = $props();

    const rowHeight = 22;
    const overscan = 6;
    // eslint-disable-next-line prefer-const -- reassigned via bind:clientHeight in template
    let viewportHeight = $state(400);
    // eslint-disable-next-line prefer-const -- reassigned via onscroll handler in template
    let scrollTop = $state(0);
    let total = $state(0);
    let rowsByIndex = $state<Map<number, Row>>(new Map());
    // eslint-disable-next-line prefer-const -- bound via bind:this in template
    let vlistEl = $state<HTMLDivElement>();

    const range = $derived(visibleRange({ scrollTop, viewportHeight, rowHeight, overscan, total }));

    // Scroll a host-selected row into view, centred, once per scroll token. Setting scrollTop fires the
    // onscroll handler, which moves the window so the target row is fetched and highlighted.
    let lastScrollToken = -1;
    $effect(() => {
        const req = scrollTo;
        const el = vlistEl;
        if (req === undefined || el === undefined || req.token === lastScrollToken) return;
        lastScrollToken = req.token;
        el.scrollTop = Math.max(0, req.index * rowHeight - Math.max(0, (viewportHeight - rowHeight) / 2));
    });

    // A version bump re-fetches the visible window (below) and overwrites those indices in place, rather than
    // emptying the map first. Keeping the existing rows on screen until the fresh ones arrive means an edit or
    // structure op refreshes the changed rows without visibly blanking and reloading the whole list. Indices
    // that fall outside the new `total` simply stop being rendered (the template iterates the range derived
    // from `total`), so stale entries beyond the list never show.
    $effect(() => {
        void version; // re-fetch the visible window after a mutation/reset
        // Filtered mode: skip the internal fetch; rows come from the parent.
        if (fixedRows !== undefined) return;
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
<div class="vlist" bind:this={vlistEl}
     bind:clientHeight={viewportHeight} onscroll={(e) => (scrollTop = (e.target as HTMLElement).scrollTop)}>
    <!-- The interpolated style= attributes below are CSP-safe: Svelte compiles a `style="...{expr}..."`
         attribute to element.style.cssText (a CSSOM mutation), which CSP does not govern. Only STATIC
         template style attributes are parsed from HTML and subject to the nonce CSP - that is why the root
         height/overflow lives on the .vlist class instead. The render-itm/spl harness CSP gate renders these
         very rows with zero violations. -->
    {#if fixedRows !== undefined}
        <!-- Filtered mode: render all provided rows as a flat list (no windowing). The fetch-all is done by
             ListSection before passing rows here; windowing is not needed because entry counts in practice
             are small enough that a full DOM render is negligible. -->
        <div style="height:{fixedRows.length * rowHeight}px;position:relative">
            {#each fixedRows as row, idx (row.id)}
                <div class="vrow" class:selected={row.id === selectedId}
                     style="position:absolute;top:{idx * rowHeight}px;height:{rowHeight}px;left:0;right:0"
                     onclick={() => onselect(row, idx)} role="button" tabindex="0"
                     onkeydown={(e) => { if (e.key === "Enter") onselect(row, idx); }}>
                    <span class="vrow-index">{idx}</span><span class="vrow-label">{rowLabel(row)}</span>
                </div>
            {/each}
        </div>
    {:else}
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
    {/if}
</div>
