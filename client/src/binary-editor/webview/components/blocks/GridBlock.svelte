<script lang="ts">
    // Flat N-column grid of label + control cells (the critter Skills block). Clumps left.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import { controlWidthClass } from "../../state/controls";
    import CellControl from "../CellControl.svelte";
    import JumpLink from "../JumpLink.svelte";

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
    // Three tracks per column (label max-content, control auto, chip auto) so each .skill is a subgrid: every
    // label in a visual column shares one max-content track and the controls align - regardless of label length
    // (a long label like "Selected weapon ability" widens only its column, it no longer shoves its own control
    // out of line). The chip track is separate from the control track: a jump chip (e.g. a CRE item slot -> its
    // Items entry) must never shrink the control it sits beside (see the field-control tier-width rules in
    // styles.css - clipping "0 BGMISC89" is exactly what the tier width exists to prevent). Column-major fill
    // (top-down first): `grid-auto-flow:column` + a fixed row count fills column 1 fully before column 2, so
    // reading order runs down each column rather than snaking across rows.
    const rows = $derived(Math.ceil(cells.length / columns));
    const gridStyle = $derived(
        `grid-template-columns:repeat(${columns},max-content auto auto);grid-auto-flow:column;grid-template-rows:repeat(${rows},auto)`,
    );
</script>
<div class="grid" style={gridStyle}>
    {#each cells as cell (cell.row.id)}
        <div class="skill">
            <span class="nm" title={cell.row.description ?? ""}>{cell.row.name}</span>
            <!-- Wrap in the same sized .field-control Field.svelte uses, so a dropdown in a grid cell is sized
                 to its longest option instead of falling to the combobox's intrinsic (clipping) width. -->
            <span class="field-control {controlWidthClass(cell.row)}">
                <CellControl row={cell.row} {onedit} />
            </span>
            <!-- Always rendered (even when empty) so every .skill contributes exactly 3 items to the subgrid;
                 a conditionally-absent 3rd child would misalign the chip track across rows. Its own track
                 shrinks to 0 when no row in this visual column carries a link. -->
            <span class="chip">
                {#if cell.row.link}
                    <JumpLink link={cell.row.link} />
                {/if}
            </span>
        </div>
    {/each}
</div>
