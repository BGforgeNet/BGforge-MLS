<script lang="ts">
    // Detail pane for a selected master-detail list entry. When the list block declares a `detailVariant`
    // (a shared layout fragment) AND the selected entry carries every field that variant references, render
    // the entry through the SAME LayoutRenderer the top-level layout uses - so an embedded record (e.g. a CRE
    // v2 effect) looks identical to its standalone form. Otherwise fall back to the generic auto-form. The
    // per-entry field map is built from the entry's own child rows keyed by semantic key (the global layout
    // `fields` map collapses every list entry to one key, so it can't render a selected entry).
    import type { DetailRow, Diagnostic, LayoutChildList, NodeId, ResolvedLayout, Row } from "@bgforge/binary-editor";
    // Import the pure helpers from their own module, NOT the package barrel: the barrel re-exports
    // dispatch/openSession (protocol/session), which transitively pull node `fs`/`path` and would break the
    // browser webview bundle. `detail-layout.ts` only type-imports binary, so its graph stays browser-safe.
    import { buildDetailFieldMap, collectEntryRows, detailVariantResolves } from "@bgforge/binary-editor/src/detail-layout";
    import type { Bridge } from "../state/bridge";
    import LayoutRenderer from "./LayoutRenderer.svelte";
    import FormSection from "./FormSection.svelte";
    import ChildEntryList from "./ChildEntryList.svelte";

    const { nodeId, detailVariant, detailVariantFallbacks, childList, labels, bridge, version, onedit, byNode, showOffsets = false }: {
        nodeId: NodeId;
        detailVariant?: DetailRow[];
        // Additional candidate fragments for a multi-record-kind list (e.g. CRE v2 vs v1 effects).
        detailVariantFallbacks?: DetailRow[][];
        // An owner-scoped child list rendered below this entry's form (e.g. MAP object inventory).
        childList?: LayoutChildList;
        labels?: Record<string, string>;
        bridge: Bridge;
        version: number;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
    } = $props();

    let rows = $state<Row[]>([]);
    $effect(() => {
        void version; // a bump re-fetches after the cache is cleared
        let cancelled = false;
        // Detail entries are small records; 1000 covers every real one (the auto-form uses the same bound).
        // Flatten nested groups (e.g. an ITM ability's Melee Animation slot array) so a fragment's group block
        // referencing the slot leaves can resolve them in the per-entry field map.
        collectEntryRows(nodeId, (id) => bridge.requestChildren(id, 0, 1000).then((w) => w.rows)).then((r) => {
            if (!cancelled) rows = r;
        });
        return () => { cancelled = true; };
    });

    const fieldMap = $derived(buildDetailFieldMap(rows, labels));
    // Candidate fragments in priority order: the primary variant, then any fallbacks (alternate record kinds).
    const candidates = $derived(
        [detailVariant, ...(detailVariantFallbacks ?? [])].filter((c): c is DetailRow[] => c !== undefined),
    );
    // Render the FIRST candidate whose refs all resolve against this entry. A shorter/older record kind (e.g. a
    // v1 effect under the v2 fragment) fails the primary and falls through to its own fallback fragment; if none
    // resolve, the auto-form renders.
    const activeVariant = $derived(
        rows.length > 0 ? candidates.find((c) => detailVariantResolves(c, fieldMap)) : undefined,
    );
    const useVariant = $derived(activeVariant !== undefined);
    const detailLayout = $derived<ResolvedLayout>({
        variantId: "detail",
        rows: activeVariant ?? [],
        fields: fieldMap,
        sections: {},
    });
</script>
{#if useVariant}
    <!-- selection/bridge/version are only consumed by `list` blocks, which a detailVariant never contains. -->
    <LayoutRenderer layout={detailLayout} {onedit} {byNode} {showOffsets} {bridge} {version} selection={undefined} />
{:else}
    <!-- The auto-form hides the childList's entry groups (e.g. "Inventory Entry N") so they are not rendered
         twice - the ChildEntryList below presents them as an editable mini master-detail with add/remove. -->
    <FormSection {nodeId} {bridge} {version} {onedit} {byNode} {showOffsets} hideGroupPrefix={childList?.entryPrefix} />
{/if}
{#if childList}
    <ChildEntryList ownerId={nodeId} {childList} {bridge} {version} {onedit} {byNode} {showOffsets} />
{/if}
