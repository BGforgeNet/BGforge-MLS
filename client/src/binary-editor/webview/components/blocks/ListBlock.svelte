<script lang="ts">
    // A variable-length array section inside a layout (e.g. ITM/SPL abilities + effects, MAP objects).
    // Delegates to the same ListSection (master-detail) / InlineList (inline) components the legacy tabs
    // path uses, via the windowed getChildren bridge - so filtering, virtualization, structure ops, and
    // nested detail forms all come for free. The section node + caps are resolved by sectionKey in
    // resolveLayout; the render mode is declared on the block.
    import type { DetailRow, Diagnostic, LayoutSection, NodeId } from "@bgforge/binary-editor";
    import type { Bridge } from "../../state/bridge";
    import ListSection from "../ListSection.svelte";
    import InlineList from "../InlineList.svelte";

    const { sectionKey, section, render, bridge, version, selection, onedit, byNode, showOffsets = false,
            detailVariant, detailVariantFallbacks, labels }: {
        sectionKey: string;
        section: LayoutSection | undefined;
        render: "inline" | "master-detail";
        bridge: Bridge;
        version: number;
        selection: NodeId | undefined;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
        // master-detail only: the shared per-entry layout fragment and the label overrides it applies.
        detailVariant?: DetailRow[];
        // Additional candidate fragments for a multi-record-kind list (e.g. CRE v2 vs v1 effects); the detail
        // pane renders the first of [detailVariant, ...fallbacks] whose refs resolve.
        detailVariantFallbacks?: DetailRow[][];
        labels?: Record<string, string>;
    } = $props();

    const caps = $derived(section ? { canAdd: section.canAdd, canModify: section.canModify } : undefined);
    function add(): void {
        if (section) bridge.structureOp({ op: "add", sectionId: section.nodeId });
    }
</script>
{#if !section}
    <!-- An optional section absent from this file (e.g. a MAP with zero local variables) renders nothing.
         A genuine sectionKey typo is caught by the per-format harness, which asserts each section resolves. -->
{:else if render === "inline"}
    <!-- Wrap so the toolbar (+add) and the row list stack vertically within the flex-row panel-blocks,
         matching the master-detail toolbar-above-list layout (InlineList itself emits two sibling roots). -->
    <div class="inline-list">
        <InlineList parentId={section.nodeId} caps={caps!} {bridge} {version} {selection} {onedit} {showOffsets} />
    </div>
{:else}
    <ListSection {sectionKey} nodeId={section.nodeId} caps={caps!} {bridge} {version} {selection}
                 onadd={add} {onedit} {byNode} {showOffsets} {detailVariant} {detailVariantFallbacks} {labels} />
{/if}
