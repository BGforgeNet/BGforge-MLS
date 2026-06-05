<script lang="ts">
    import type { Diagnostic, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { ViewModel } from "../state/view-model";
    import { rowActions, type SectionCaps } from "../state/structure-actions";
    import VirtualList from "./VirtualList.svelte";
    import FormSection from "./FormSection.svelte";
    import RowActions from "./RowActions.svelte";

    // Max rows scanned when resolving a post-op host selection back to a list index. Exceeding this silently leaves the
    // detail pane unselected; safe for ITM abilities/effects (typically <10) but revisit if any list section can exceed it.
    const SELECTION_RESOLVE_SCAN_LIMIT = 256;

    const { nodeId, title, caps, bridge, vm, version, selection, onadd, onedit, byNode, showOffsets = false }:
        { nodeId: NodeId; title: string; caps: SectionCaps; bridge: Bridge; vm: ViewModel;
          version: number; selection: NodeId | undefined;
          onadd: () => void; onedit: (id: string, v: number | string) => void;
          byNode: Map<string, Diagnostic[]>; showOffsets?: boolean } = $props();

    // eslint-disable-next-line prefer-const -- reassigned via onselect callback
    let selected = $state<Row | undefined>();
    // Index of the selected row in the master list; needed by rowActions to compute up/down enablement.
    // eslint-disable-next-line prefer-const -- reassigned alongside selected via onselect
    let selectedIndex = $state<number | undefined>();
    let total = $state(0);
    // Guards applying the host selection at most once per version, so navigating the master list never
    // overrides a user click triggered by a structure op.
    let appliedSelectionVersion = -1;

    // Switching sections is a full reset.
    $effect(() => {
        void nodeId;
        selected = undefined;
        selectedIndex = undefined;
        appliedSelectionVersion = -1;
    });

    // After a structure op the host returns the NodeId to keep selected. Re-resolve it once the new
    // version's rows are loaded so the detail pane re-opens on the mutated/inserted entry instead of
    // collapsing. VirtualList owns the row-fetch loop; we request the first page here solely to learn
    // the total and resolve the selection - VirtualList will separately fetch its visible window.
    $effect(() => {
        void version;
        selected = undefined;
        selectedIndex = undefined;
        if (selection === undefined || appliedSelectionVersion === version) return;
        appliedSelectionVersion = version;
        let cancelled = false;
        // Fetch enough rows to find the selection. For large lists this may miss entries beyond the
        // first page; in practice ITM ability/effect lists are small (typically <10 entries).
        bridge.requestChildren(nodeId, 0, SELECTION_RESOLVE_SCAN_LIMIT).then((w) => {
            if (cancelled) return;
            total = w.total;
            w.rows.forEach((r, i) => {
                if (r.id === selection) { selected = r; selectedIndex = i; }
            });
        });
        return () => { cancelled = true; };
    });

    // Keep total in sync when VirtualList fetches rows (it drives the scroll, but we need total for
    // rowActions). VirtualList exposes no callback for total, so we re-request a small window on
    // version change just for the total when no selection resolve is pending.
    $effect(() => {
        void version;
        if (selection !== undefined) return; // covered by the selection-resolve effect above
        let cancelled = false;
        bridge.requestChildren(nodeId, 0, 1).then((w) => {
            if (cancelled) return;
            total = w.total;
        });
        return () => { cancelled = true; };
    });

    // NOTE: entryPath uses the display name [title, row.name]. For ITM abilities/effects row.name is
    // a positional label ("Ability N" / "Effect N"), which the ITM builder resolves by exactly that
    // label. For formats whose entry labels are derived rather than positional, revisit this addressing
    // when those formats gain structure ops.
    const entryPath = (row: Row): string[] => [title, row.name];
</script>
<div class="master-detail">
    <div class="master">
        {#if caps.canAdd}<div class="toolbar"><button onclick={onadd}>+ add</button></div>{/if}
        <VirtualList parentId={nodeId} {bridge} {version} selectedId={selected?.id}
                     onselect={(r, idx) => { selected = r; selectedIndex = idx; }} />
    </div>
    <div class="detail">
        {#if selected}
            {#if selectedIndex !== undefined}
                {@const acts = rowActions(selectedIndex, total, caps)}
                <RowActions {acts} entryPath={entryPath(selected)} {bridge} />
            {/if}
            <FormSection nodeId={selected.id} {bridge} {vm} {version} {onedit} {byNode} {showOffsets} />
        {:else}
            <p class="placeholder">Select an entry.</p>
        {/if}
    </div>
</div>
