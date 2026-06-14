<script lang="ts">
    // 2D matrix: fixed-width column-groups (Primary / Secondary / ...), each a sub-table whose labelled
    // rows hold one bare control per value-column (Base | Bonus). The critter Stats block.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import CellControl from "../CellControl.svelte";

    const { valueColumns, groups, columnWidthPx = 190, fields, onedit }: {
        valueColumns: { key: string; label: string; widthPx?: number }[];
        groups: { label: string; rows: { label: string; cells: Record<string, FieldRef> }[] }[];
        columnWidthPx?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
    } = $props();

    const gridStyle = $derived(`grid-template-columns:repeat(${groups.length},${columnWidthPx}px)`);
    // Per-value-column cell width; default 56px (the narrow numeric base/bonus cell). A column may widen to fit
    // a control that needs room (e.g. a dropdown) via its `widthPx`.
    const cellWidth = (vc: { widthPx?: number }): string => `width:${vc.widthPx ?? 56}px`;
</script>
<div class="matrix" style={gridStyle}>
    {#each groups as group, gi (gi)}
        <div class="mcol">
            <div class="sub">
                <span class="lbl">{group.label}</span>
                {#each valueColumns as vc (vc.key)}<span class="bb" style={cellWidth(vc)}>{vc.label}</span>{/each}
            </div>
            {#each group.rows as r, ri (ri)}
                <div class="strow">
                    <span class="nm" title={r.label}>{r.label}</span>
                    {#each valueColumns as vc (vc.key)}
                        {@const ref = r.cells[vc.key]}
                        {@const row = ref ? fields[ref] : undefined}
                        <span class="c" style={cellWidth(vc)}>{#if row}<CellControl {row} {onedit} />{/if}</span>
                    {/each}
                </div>
            {/each}
        </div>
    {/each}
</div>
