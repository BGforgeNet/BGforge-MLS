<script lang="ts">
    // A variable-length array section inside a layout (e.g. ITM/SPL abilities + effects, MAP objects).
    // Delegates to the same ListSection (master-detail) / InlineList (inline) components the legacy tabs
    // path uses, via the windowed getChildren bridge - so filtering, virtualization, structure ops, and
    // nested detail forms all come for free. The section node + caps are resolved by sectionKey in
    // resolveLayout; the render mode is declared on the block.
    import type { Diagnostic, LayoutSection, NodeId } from "@bgforge/binary-editor";
    import type { Bridge } from "../../state/bridge";
    import type { ViewModel } from "../../state/view-model";
    import ListSection from "../ListSection.svelte";
    import InlineList from "../InlineList.svelte";

    const { sectionKey, section, render, bridge, vm, version, selection, onedit, byNode, showOffsets = false }: {
        sectionKey: string;
        section: LayoutSection | undefined;
        render: "inline" | "master-detail";
        bridge: Bridge;
        vm: ViewModel;
        version: number;
        selection: NodeId | undefined;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
    } = $props();

    const caps = $derived(section ? { canAdd: section.canAdd, canModify: section.canModify } : undefined);
    function add(): void {
        if (section) bridge.structureOp({ op: "add", sectionId: section.nodeId });
    }
</script>
{#if !section}
    <div class="layout-stub">List section "{sectionKey}" not found in the model.</div>
{:else if render === "inline"}
    <InlineList parentId={section.nodeId} caps={caps!} {bridge} {version} {selection} {onedit} {showOffsets} />
{:else}
    <ListSection nodeId={section.nodeId} caps={caps!} {bridge} {vm} {version} {selection}
                 onadd={add} {onedit} {byNode} {showOffsets} />
{/if}
