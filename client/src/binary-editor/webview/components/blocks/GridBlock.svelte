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
    // Two tracks per column (label max-content, control) so each .skill is a subgrid: every label in a visual
    // column shares one max-content track and the controls align - regardless of label length (a long label
    // like "Selected weapon ability" widens only its column, it no longer shoves its own control out of line).
    // Fill column-major (top-down first): `grid-auto-flow:column` + a fixed row count fills column 1 fully
    // before column 2, so reading order runs down each column rather than snaking across rows.
    const rows = $derived(Math.ceil(cells.length / columns));
    const gridStyle = $derived(
        `grid-template-columns:repeat(${columns},max-content auto);grid-auto-flow:column;grid-template-rows:repeat(${rows},auto)`,
    );
</script>
<div class="grid" style={gridStyle}>
    {#each cells as cell (cell.row.id)}
        <div class="skill">
            <span class="nm" title={cell.row.description ?? ""}>{cell.row.name}</span>
            <CellControl row={cell.row} {onedit} />
        </div>
    {/each}
</div>
