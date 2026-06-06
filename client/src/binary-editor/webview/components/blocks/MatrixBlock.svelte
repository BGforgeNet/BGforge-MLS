<script lang="ts">
    // 2D matrix: fixed-width column-groups (Primary / Secondary / ...), each a sub-table whose labelled
    // rows hold one bare control per value-column (Base | Bonus). The critter Stats block.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import CellControl from "../CellControl.svelte";

    const { valueColumns, groups, columnWidthPx = 190, fields, onedit, showBytes = false }: {
        valueColumns: { key: string; label: string }[];
        groups: { label: string; rows: { label: string; cells: Record<string, FieldRef> }[] }[];
        columnWidthPx?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        showBytes?: boolean;
    } = $props();

    const gridStyle = $derived(`grid-template-columns:repeat(${groups.length},${columnWidthPx}px)`);
</script>
<div class="matrix" style={gridStyle}>
    {#each groups as group, gi (gi)}
        <div class="mcol">
            <div class="sub">
                <span class="lbl">{group.label}</span>
                {#each valueColumns as vc (vc.key)}<span class="bb">{vc.label}</span>{/each}
            </div>
            {#each group.rows as r, ri (ri)}
                <div class="strow">
                    <span class="nm" title={r.label}>{r.label}</span>
                    {#each valueColumns as vc (vc.key)}
                        {@const ref = r.cells[vc.key]}
                        {@const row = ref ? fields[ref] : undefined}
                        <span class="c">{#if row}<CellControl {row} {onedit} {showBytes} />{/if}</span>
                    {/each}
                </div>
            {/each}
        </div>
    {/each}
</div>
