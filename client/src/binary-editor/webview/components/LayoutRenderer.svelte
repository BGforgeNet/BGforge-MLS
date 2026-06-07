<script lang="ts">
    // Generic renderer for a format's declarative layout: rows of panels, each panel a stack of blocks,
    // each block dispatched to its primitive. Content hugs `maxContentWidthPx` and clumps left (the
    // single dense page the PRO redesign targets). Field rows are pre-resolved in `layout.fields`.
    import type { Diagnostic, NodeId, ResolvedLayout } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import FieldsBlock from "./blocks/FieldsBlock.svelte";
    import FlagColumns from "./blocks/FlagColumns.svelte";
    import MatrixBlock from "./blocks/MatrixBlock.svelte";
    import GridBlock from "./blocks/GridBlock.svelte";
    import ListBlock from "./blocks/ListBlock.svelte";
    import RawBlock from "./blocks/RawBlock.svelte";

    // bridge/version/selection are only needed by `list` blocks (variable-length sections render via the
    // live windowed getChildren path); form-only layouts (PRO/EFF) ignore them.
    const { layout, onedit, byNode, showOffsets = false, bridge, version, selection }: {
        layout: ResolvedLayout;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
        bridge: Bridge;
        version: number;
        selection: NodeId | undefined;
    } = $props();

    const rootStyle = $derived(`max-width:${layout.maxContentWidthPx ?? 900}px`);

    // A `list` block targeting a section absent from this file (e.g. a MAP with no local variables, or fewer
    // than three elevations) produces no content. Prune its panel - and any row left with only such panels -
    // so absent optional sections leave no empty titled box. Non-list blocks always count as content.
    function blockHasContent(block: ResolvedLayout["rows"][number]["panels"][number]["blocks"][number]): boolean {
        return block.kind !== "list" || layout.sections[block.sectionKey] !== undefined;
    }
    const panelHasContent = (panel: ResolvedLayout["rows"][number]["panels"][number]): boolean =>
        panel.blocks.some(blockHasContent);
    const rowHasContent = (row: ResolvedLayout["rows"][number]): boolean => row.panels.some(panelHasContent);
</script>
<div class="layout-root" style={rootStyle}>
    {#each layout.rows as row, ri (ri)}
        {#if rowHasContent(row)}
        <div class="layout-row">
            {#each row.panels as panel, pi (pi)}
                {#if panelHasContent(panel)}
                <div class="panel" style={panel.widthPx ? `width:${panel.widthPx}px` : ""}>
                    {#if panel.title}<h3>{panel.title}</h3>{/if}
                    <div class="panel-blocks">
                        {#each panel.blocks as block, bi (bi)}
                            {#if block.kind === "fields"}
                                <FieldsBlock fieldRefs={block.fields} columns={block.columns}
                                             fields={layout.fields} {onedit} {byNode} {showOffsets} />
                            {:else if block.kind === "flags"}
                                <FlagColumns field={block.field} columns={block.columns}
                                             descriptions={block.descriptions}
                                             fields={layout.fields} {onedit} />
                            {:else if block.kind === "matrix"}
                                <MatrixBlock valueColumns={block.valueColumns} groups={block.groups}
                                             columnWidthPx={block.columnWidthPx} fields={layout.fields}
                                             {onedit} showBytes={showOffsets} />
                            {:else if block.kind === "grid"}
                                <GridBlock columns={block.columns} items={block.items}
                                           fields={layout.fields} {onedit} showBytes={showOffsets} />
                            {:else if block.kind === "list"}
                                <ListBlock sectionKey={block.sectionKey} section={layout.sections[block.sectionKey]}
                                           render={block.render} {bridge} {version} {selection}
                                           {onedit} {byNode} {showOffsets} />
                            {:else}
                                <RawBlock />
                            {/if}
                        {/each}
                    </div>
                </div>
                {/if}
            {/each}
        </div>
        {/if}
    {/each}
</div>
