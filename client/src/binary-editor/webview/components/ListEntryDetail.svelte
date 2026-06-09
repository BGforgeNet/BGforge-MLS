<script lang="ts">
    // Detail pane for a selected master-detail list entry. When the list block declares a `detailVariant`
    // (a shared layout fragment) AND the selected entry carries every field that variant references, render
    // the entry through the SAME LayoutRenderer the top-level layout uses - so an embedded record (e.g. a CRE
    // v2 effect) looks identical to its standalone form. Otherwise fall back to the generic auto-form. The
    // per-entry field map is built from the entry's own child rows keyed by semantic key (the global layout
    // `fields` map collapses every list entry to one key, so it can't render a selected entry).
    import type { DetailRow, Diagnostic, NodeId, ResolvedLayout, Row } from "@bgforge/binary-editor";
    // Import the pure helpers from their own module, NOT the package barrel: the barrel re-exports
    // dispatch/openSession (protocol/session), which transitively pull node `fs`/`path` and would break the
    // browser webview bundle. `detail-layout.ts` only type-imports binary, so its graph stays browser-safe.
    import { buildDetailFieldMap, detailVariantResolves } from "@bgforge/binary-editor/src/detail-layout";
    import type { Bridge } from "../state/bridge";
    import LayoutRenderer from "./LayoutRenderer.svelte";
    import FormSection from "./FormSection.svelte";

    const { nodeId, detailVariant, labels, bridge, version, onedit, byNode, showOffsets = false }: {
        nodeId: NodeId;
        detailVariant?: DetailRow[];
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
        bridge.requestChildren(nodeId, 0, 1000).then((w) => { if (!cancelled) rows = w.rows; });
        return () => { cancelled = true; };
    });

    const fieldMap = $derived(buildDetailFieldMap(rows, labels));
    // Use the shared fragment only when the entry actually has all its fields (a shorter record kind under a
    // longer variant - e.g. a v1 effect under the v2 fragment - fails this and falls back to the auto-form).
    const useVariant = $derived(
        detailVariant !== undefined && rows.length > 0 && detailVariantResolves(detailVariant, fieldMap),
    );
    const detailLayout = $derived<ResolvedLayout>({
        variantId: "detail",
        rows: detailVariant ?? [],
        fields: fieldMap,
        sections: {},
    });
</script>
{#if useVariant}
    <!-- selection/bridge/version are only consumed by `list` blocks, which a detailVariant never contains. -->
    <LayoutRenderer layout={detailLayout} {onedit} {byNode} {showOffsets} {bridge} {version} selection={undefined} />
{:else}
    <FormSection {nodeId} {bridge} {version} {onedit} {byNode} {showOffsets} />
{/if}
