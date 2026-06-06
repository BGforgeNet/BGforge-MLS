<script lang="ts">
    // Generic renderer for a format's declarative layout: rows of panels, each panel a stack of blocks,
    // each block dispatched to its primitive. Content hugs `maxContentWidthPx` and clumps left (the
    // single dense page the PRO redesign targets). Field rows are pre-resolved in `layout.fields`.
    import type { Diagnostic, ResolvedLayout } from "@bgforge/binary-editor";
    import FieldsBlock from "./blocks/FieldsBlock.svelte";
    import FlagColumns from "./blocks/FlagColumns.svelte";
    import MatrixBlock from "./blocks/MatrixBlock.svelte";
    import GridBlock from "./blocks/GridBlock.svelte";
    import ListBlock from "./blocks/ListBlock.svelte";
    import RawBlock from "./blocks/RawBlock.svelte";

    const { layout, onedit, byNode, showOffsets = false }: {
        layout: ResolvedLayout;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
    } = $props();

    const rootStyle = $derived(`max-width:${layout.maxContentWidthPx ?? 900}px`);
</script>
<div class="layout-root" style={rootStyle}>
    {#each layout.rows as row, ri (ri)}
        <div class="layout-row">
            {#each row.panels as panel, pi (pi)}
                <div class="panel" style={panel.widthPx ? `width:${panel.widthPx}px` : ""}>
                    {#if panel.title}<h3>{panel.title}</h3>{/if}
                    <div class="panel-blocks">
                        {#each panel.blocks as block, bi (bi)}
                            {#if block.kind === "fields"}
                                <FieldsBlock fieldRefs={block.fields} columns={block.columns}
                                             searchable={block.searchable}
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
                                <ListBlock sectionKey={block.sectionKey} />
                            {:else}
                                <RawBlock />
                            {/if}
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/each}
</div>
