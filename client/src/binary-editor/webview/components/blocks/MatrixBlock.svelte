<script lang="ts">
    // 2D matrix: fixed-width column-groups (Primary / Secondary / ...), each a sub-table whose labelled
    // rows hold one bare control per value-column (Base | Bonus). The critter Stats block.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import { readOnlyTitle } from "../../state/controls";
    import CellControl from "../CellControl.svelte";
    import DocLink from "../DocLink.svelte";
    import FieldAffordances from "../FieldAffordances.svelte";

    const { valueColumns, groups, columnWidthPx = 190, fields, onedit, byNode }: {
        valueColumns: { key: string; label: string; widthPx?: number }[];
        groups: { label: string; rows: { label: string; cells: Record<string, FieldRef> }[] }[];
        columnWidthPx?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
    } = $props();

    // The groups sit in one row while it fits and wrap below it when the panel is narrower (styles.css `.matrix`).
    const matrixStyle = $derived(`--mcol-w:${columnWidthPx}px`);
    // Per-value-column cell width; default 56px (the narrow numeric base/bonus cell). A column may widen to fit
    // a control that needs room (e.g. a dropdown) via its `widthPx`.
    const cellWidth = (vc: { widthPx?: number }): string => `width:${vc.widthPx ?? 56}px`;
    const cellRows = (cells: Record<string, FieldRef>): Row[] =>
        valueColumns.map((vc) => cells[vc.key]).flatMap((ref) => (ref && fields[ref] ? [fields[ref]] : []));
    // The label names the matrix row, not any one cell, so each cell's description follows it in the tooltip.
    const labelTitle = (label: string, rows: Row[]): string =>
        [label, ...rows.flatMap((row) => (row.description ? [row.description] : []))].join("\n");
</script>
<div class="matrix" style={matrixStyle}>
    {#each groups as group, gi (gi)}
        <div class="mcol">
            <div class="sub">
                <span class="lbl">{group.label}</span>
                {#each valueColumns as vc (vc.key)}<span class="bb" style={cellWidth(vc)}>{vc.label}</span>{/each}
            </div>
            {#each group.rows as r, ri (ri)}
                {@const rows = cellRows(r.cells)}
                <div class="strow">
                    <span class="nm" title={labelTitle(r.label, rows)}>{r.label}</span>
                    <!-- Each cell's doc link and affordances sit between the label and the cells, outside the
                         ellipsizing label: the label is the only flexible track, so a marker appearing shortens
                         it and never moves a value column. No whitespace inside, so an empty slot is `:empty`. -->
                    <span class="m-aff">{#each rows as row (row.id)}<DocLink url={row.docUrl} description={row.description}
                        />{/each}{#each rows as row (row.id)}<FieldAffordances {row} {onedit}
                        diagnostics={byNode.get(row.id)} compact />{/each}</span>
                    {#each valueColumns as vc (vc.key)}
                        {@const ref = r.cells[vc.key]}
                        {@const row = ref ? fields[ref] : undefined}
                        <span class="c" style={cellWidth(vc)} title={row ? readOnlyTitle(row) : undefined}>{#if row}<CellControl {row} {onedit} compact />{/if}</span>
                    {/each}
                </div>
            {/each}
        </div>
    {/each}
</div>
