<script lang="ts">
    import type { Diagnostic, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { rowActions, type SectionCaps } from "../state/structure-actions";
    import { filterRows } from "../state/filter";
    import VirtualList from "./VirtualList.svelte";
    import FormSection from "./FormSection.svelte";
    import RowActions from "./RowActions.svelte";
    import Icon from "./Icon.svelte";

    // Max rows scanned when resolving a post-op host selection back to a list index. Exceeding this silently leaves the
    // detail pane unselected; safe for ITM abilities/effects (typically <10) but revisit if any list section can exceed it.
    const SELECTION_RESOLVE_SCAN_LIMIT = 256;

    const { nodeId, caps, bridge, version, selection, onadd, onedit, byNode, showOffsets = false }:
        { nodeId: NodeId; caps: SectionCaps; bridge: Bridge;
          version: number; selection: NodeId | undefined;
          onadd: () => void; onedit: (id: string, v: number | string) => void;
          byNode: Map<string, Diagnostic[]>; showOffsets?: boolean } = $props();

    // eslint-disable-next-line prefer-const -- reassigned via onselect callback
    let selected = $state<Row | undefined>();
    // Index of the selected row in the master list; needed by rowActions to compute up/down enablement.
    // eslint-disable-next-line prefer-const -- reassigned alongside selected via onselect
    let selectedIndex = $state<number | undefined>();
    let total = $state(0);
    // The last host-provided selection actually applied, tracked by VALUE (not by version). A structure op or
    // field edit hands back a NodeId to keep active; we apply it exactly once, when it changes. Tracking by
    // value (rather than re-applying on every version bump) means an unrelated refresh never wipes a selection
    // the user just made by clicking - the user's click stays authoritative until the host sends a NEW selection.
    let lastAppliedSelection: NodeId | undefined;

    // Filter state: the search query typed by the user.
    // eslint-disable-next-line prefer-const -- reassigned by the filter input
    let filterQuery = $state("");
    // Full row set fetched on demand when a filter query is active. Client-side full-fetch filtering is
    // simple and correct for the entry counts in practice (effects/abilities are small; even thousands of
    // MAP objects are lightweight rows). A core-side filter is deferred as not needed at current scale.
    let allRows = $state<Row[]>([]);
    // eslint-disable-next-line prefer-const -- reassigned by the full-fetch effect
    let allRowsFetched = $state(false);

    const activeQuery = $derived(filterQuery.trim().toLowerCase());
    const filteredRows = $derived(activeQuery ? filterRows(allRows, filterQuery) : undefined);

    // Switching sections is a full reset (including filter state).
    $effect(() => {
        void nodeId;
        selected = undefined;
        selectedIndex = undefined;
        lastAppliedSelection = undefined;
        filterQuery = "";
        allRows = [];
        allRowsFetched = false;
    });

    // When a filter query becomes active, fetch all rows so filterRows has the complete set.
    // Re-runs on version bumps so structure-op mutations are reflected in the filtered view.
    $effect(() => {
        void version;
        if (!activeQuery) { allRows = []; allRowsFetched = false; return; }
        if (total === 0) return; // wait until total is known
        let cancelled = false;
        bridge.requestChildren(nodeId, 0, total).then((w) => {
            if (cancelled) return;
            allRows = w.rows;
            allRowsFetched = true;
        });
        return () => { cancelled = true; };
    });

    // Resolve selection and total after every version bump (open, edit, structure op). Two distinct jobs:
    //   1. Apply a NEW host-provided selection (a structure op / edit hands back the entry to keep active).
    //      Applied once per selection VALUE, so a user's manual click is never overridden by an unrelated
    //      refresh - only a genuinely new host selection moves the detail pane.
    //   2. Otherwise keep the user's current selection, refreshing its row snapshot and index in place so an
    //      edit updates the summary without collapsing or visibly reloading the detail. A selected row that no
    //      longer exists (removed) clears the pane.
    // VirtualList owns the visible-window fetch; this scan exists to learn `total` (needed by rowActions) and
    // to resolve selection by id. For lists longer than the scan limit a selection beyond it is not resolved.
    $effect(() => {
        void version;
        const hostSelection = selection;
        let cancelled = false;
        bridge.requestChildren(nodeId, 0, SELECTION_RESOLVE_SCAN_LIMIT).then((w) => {
            if (cancelled) return;
            total = w.total;
            if (hostSelection !== undefined && hostSelection !== lastAppliedSelection) {
                lastAppliedSelection = hostSelection;
                const i = w.rows.findIndex((r) => r.id === hostSelection);
                if (i !== -1) { selected = w.rows[i]; selectedIndex = i; return; }
            }
            // No new host selection to apply: keep the user's current pick, refreshing its snapshot/index.
            const cur = selected;
            if (cur !== undefined) {
                const i = w.rows.findIndex((r) => r.id === cur.id);
                if (i !== -1) { selected = w.rows[i]; selectedIndex = i; }
                else { selected = undefined; selectedIndex = undefined; }
            }
        });
        return () => { cancelled = true; };
    });

</script>
<div class="master-detail">
    <div class="master">
        {#if caps.canAdd}<div class="toolbar"><button onclick={onadd}>+ add</button></div>{/if}
        <div class="list-filter">
            <Icon name="search" />
            <input
                type="text"
                class="list-filter-input"
                placeholder="Filter..."
                aria-label="Filter entries"
                bind:value={filterQuery}
            />
            {#if filterQuery}
                <button class="list-filter-clear" aria-label="Clear filter" onclick={() => { filterQuery = ""; }}>
                    <Icon name="close" />
                </button>
            {/if}
        </div>
        {#if filteredRows !== undefined}
            {#if filteredRows.length === 0}
                <p class="placeholder list-filter-empty">No matches.</p>
            {:else}
                <VirtualList parentId={nodeId} {bridge} {version} selectedId={selected?.id}
                             rows={filteredRows}
                             onselect={(r, idx) => { selected = r; selectedIndex = idx; }} />
            {/if}
        {:else}
            <VirtualList parentId={nodeId} {bridge} {version} selectedId={selected?.id}
                         onselect={(r, idx) => { selected = r; selectedIndex = idx; }} />
        {/if}
    </div>
    <div class="detail">
        {#if selected}
            {#if selectedIndex !== undefined}
                {@const acts = rowActions(selectedIndex, total, caps)}
                <RowActions {acts} entryId={selected.id} {bridge} />
            {/if}
            <FormSection nodeId={selected.id} {bridge} {version} {onedit} {byNode} {showOffsets} />
        {:else}
            <p class="placeholder">Select an entry.</p>
        {/if}
    </div>
</div>
