<script lang="ts">
    // Flat N-column grid of label + control cells (the critter Skills block). Clumps left.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import CellControl from "../CellControl.svelte";

    const { columns, items, fields, onedit }: {
        columns: number;
        items: FieldRef[];
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
    } = $props();

    const cells = $derived(
        items
            .map((ref) => ({ ref, row: fields[ref] }))
            .filter((c): c is { ref: FieldRef; row: Row } => c.row !== undefined),
    );
    const gridStyle = $derived(`grid-template-columns:repeat(${columns},max-content)`);
</script>
<div class="grid" style={gridStyle}>
    {#each cells as cell (cell.row.id)}
        <div class="skill">
            <span class="nm" title={cell.row.description ?? ""}>{cell.row.name}</span>
            <CellControl row={cell.row} {onedit} />
        </div>
    {/each}
</div>
