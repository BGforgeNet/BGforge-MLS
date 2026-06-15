<script lang="ts">
    import type { DetailRow, Diagnostic, LayoutChildList, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { rowActions, type SectionCaps } from "../state/structure-actions";
    import { filterRows } from "../state/filter";
    import { rememberSelection, recallSelection } from "../state/list-selection-memory";
    import { locateEntry } from "../state/list-window";
    import VirtualList from "./VirtualList.svelte";
    import ListEntryDetail from "./ListEntryDetail.svelte";
    import RowActions from "./RowActions.svelte";
    import Icon from "./Icon.svelte";

    // Initial bounded window fetched to resolve a selection's index and learn `total`. A target within it
    // resolves immediately; a target beyond it (a cross-record jump to a deep entry in a large list) triggers a
    // one-off full fetch via locateEntry, so it still resolves rather than falling back to the first entry.
    const SELECTION_RESOLVE_SCAN_LIMIT = 256;

    const { sectionKey, nodeId, caps, bridge, version, selection, onadd, onedit, byNode,
            detailVariant, detailVariantFallbacks, childList, labels }:
        { sectionKey: string; nodeId: NodeId; caps: SectionCaps; bridge: Bridge;
          version: number; selection: NodeId | undefined;
          onadd: () => void; onedit: (id: string, v: number | string) => void;
          byNode: Map<string, Diagnostic[]>;
          detailVariant?: DetailRow[]; detailVariantFallbacks?: DetailRow[][];
          childList?: LayoutChildList;
          labels?: Record<string, string> } = $props();

    // eslint-disable-next-line prefer-const -- reassigned via onselect callback
    let selected = $state<Row | undefined>();
    // Index of the selected row in the master list; needed by rowActions to compute up/down enablement.
    // eslint-disable-next-line prefer-const -- reassigned alongside selected via onselect
    let selectedIndex = $state<number | undefined>();
    let total = $state(0);
    // Token-gated scroll request handed to the master VirtualList: bumped only when a HOST selection is applied
    // (a cross-record jump, or a structure op handing back an entry), so the list scrolls that entry into view.
    // A plain user click does not bump it, so clicking never yanks the list under the user.
    let scrollTarget = $state<{ index: number; token: number } | undefined>();
    // The last host-provided selection actually applied, tracked by VALUE (not by version). A structure op or
    // field edit hands back a NodeId to keep active; we apply it exactly once, when it changes. Tracking by
    // value (rather than re-applying on every version bump) means an unrelated refresh never wipes a selection
    // the user just made by clicking - the user's click stays authoritative until the host sends a NEW selection.
    let lastAppliedSelection: NodeId | undefined;

    // Single point that moves the selection: updates the detail pane and records the pick in the per-section
    // memory so switching tabs and returning restores it. Every selection path (user click, host op, restore)
    // routes through here so the memory never drifts from what is shown.
    function pick(row: Row, index: number): void {
        selected = row;
        selectedIndex = index;
        rememberSelection(sectionKey, row.id);
    }

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
        const fetchWindow = (start: number, end: number) => bridge.requestChildren(nodeId, start, end);
        void (async () => {
            const w = await fetchWindow(0, SELECTION_RESOLVE_SCAN_LIMIT);
            if (cancelled) return;
            total = w.total;

            // 1. Apply a NEW host-provided selection (a cross-record jump, or a structure op handing back the
            //    entry to keep active). A jump target can sit beyond the bounded window in a large list, so
            //    locateEntry fetches the full list to find it rather than falling back to the first entry.
            if (hostSelection !== undefined && hostSelection !== lastAppliedSelection) {
                lastAppliedSelection = hostSelection;
                const { rows, index } = await locateEntry(fetchWindow, w.rows, w.total, hostSelection);
                if (cancelled) return;
                if (index !== -1) {
                    pick(rows[index], index);
                    // Host selection (e.g. a jump): bring the entry into view in the master list.
                    scrollTarget = { index, token: (scrollTarget?.token ?? 0) + 1 };
                    return;
                }
            }

            // 2. Otherwise keep the user's current pick, refreshing its snapshot/index in place. A selection
            //    beyond the window stays put (an edit must not collapse it); only clear it when the whole list is
            //    within the window and the row is genuinely gone (removed).
            const cur = selected;
            if (cur !== undefined) {
                const i = w.rows.findIndex((r) => r.id === cur.id);
                if (i !== -1) pick(w.rows[i], i);
                else if (w.total <= w.rows.length) { selected = undefined; selectedIndex = undefined; }
                return;
            }

            // 3. Fresh mount or tab switch: restore this section's remembered entry (resolved even if it sits
            //    deep), falling back to the first entry so the detail pane never opens empty.
            const remembered = recallSelection(sectionKey);
            const found =
                remembered !== undefined
                    ? await locateEntry(fetchWindow, w.rows, w.total, remembered)
                    : { rows: w.rows, index: -1 };
            if (cancelled) return;
            if (found.index !== -1) pick(found.rows[found.index], found.index);
            else if (w.rows.length > 0) pick(w.rows[0], 0);
        })();
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
                             onselect={(r, idx) => pick(r, idx)} />
            {/if}
        {:else}
            <VirtualList parentId={nodeId} {bridge} {version} selectedId={selected?.id}
                         scrollTo={scrollTarget} onselect={(r, idx) => pick(r, idx)} />
        {/if}
    </div>
    <div class="detail">
        {#if selected}
            {#if selectedIndex !== undefined}
                {@const acts = rowActions(selectedIndex, total, caps)}
                <RowActions {acts} entryId={selected.id} {bridge} />
            {/if}
            <ListEntryDetail nodeId={selected.id} {detailVariant} {detailVariantFallbacks} {childList} {labels} {bridge} {version} {onedit} {byNode} />
        {:else}
            <p class="placeholder">Select an entry.</p>
        {/if}
    </div>
</div>
