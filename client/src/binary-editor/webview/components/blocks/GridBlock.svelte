<script lang="ts">
    // Flat N-column grid of label + control cells (the critter Skills block). Clumps left.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import { controlWidthClass } from "../../state/controls";
    import { useJump } from "../../state/jump-context";
    import CellControl from "../CellControl.svelte";
    import DocLink from "../DocLink.svelte";

    const { columns, items, fields, onedit }: {
        columns: number;
        items: FieldRef[];
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
    } = $props();
    const jump = useJump();

    const cells = $derived(
        items
            .map((ref) => ({ ref, row: fields[ref] }))
            .filter((c): c is { ref: FieldRef; row: Row } => c.row !== undefined),
    );
    // Two tracks per column (label max-content, control auto) so each .skill is a subgrid: every label in a
    // visual column shares one max-content track and the controls align - regardless of label length (a long
    // label like "Selected weapon ability" widens only its column, it no longer shoves its own control out of
    // line). A cross-record jump (e.g. a CRE item slot -> its Items entry) is the LABEL itself acting as a link,
    // so it lives in the existing label track and adds no track of its own. Column-major fill (top-down first):
    // `grid-auto-flow:column` + a fixed row count fills column 1 fully before column 2, so reading order runs
    // down each column rather than snaking across rows.
    const rows = $derived(Math.ceil(cells.length / columns));
    const gridStyle = $derived(
        `grid-template-columns:repeat(${columns},max-content auto);grid-auto-flow:column;grid-template-rows:repeat(${rows},auto)`,
    );
</script>
<div class="grid" style={gridStyle}>
    {#each cells as cell (cell.row.id)}
        <div class="skill">
            {#if cell.row.link && jump}
                {@const link = cell.row.link}
                <!-- The slot LABEL is the jump link. For a CRE item slot the label ("Weapon 2") NAMES the linked
                     record - the referenced Items entry IS "Weapon 2" - so the label itself is the natural,
                     unambiguous affordance to jump to. (Contrast the MAP script-SID chip in Field.svelte, where
                     the label names the FIELD and the link target is a reverse-referenced object, so a separate
                     chip is correct there.) It is a real button: keyboard-operable with a visible focus ring. -->
                <button
                    type="button"
                    class="nm nm-link"
                    title={`Go to ${link.label}`}
                    onclick={() => jump(link)}>{cell.row.name}</button>
            {:else}
                <span class="nm" title={cell.row.description ?? ""}>{cell.row.name}<DocLink url={cell.row.docUrl} description={cell.row.description} /></span>
            {/if}
            <!-- Wrap in the same sized .field-control Field.svelte uses, so a dropdown in a grid cell is sized
                 to its longest option instead of falling to the combobox's intrinsic (clipping) width. -->
            <span class="field-control {controlWidthClass(cell.row)}">
                <CellControl row={cell.row} {onedit} />
            </span>
        </div>
    {/each}
</div>
