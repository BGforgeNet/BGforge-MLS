<script lang="ts">
    // Key/value list of fields (label + control), optionally in N columns. Reuses Field.svelte so
    // diagnostics, offsets, and every control type come for free. Unresolved refs are skipped.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import Field from "../Field.svelte";

    const { fieldRefs, columns, fields, onedit, byNode, showOffsets = false }: {
        fieldRefs: FieldRef[];
        columns?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
    } = $props();

    const rows = $derived(fieldRefs.map((ref) => fields[ref]).filter((r): r is Row => r !== undefined));
    // Multi-column list: each column is a (label, value) pair of tracks - `max-content` so the label hugs
    // its text (shared per column, so values still align vertically), `auto` for the control. Each Field is
    // a subgrid spanning its pair, so short labels no longer sit in a fixed-width box far from their value.
    const multi = $derived(columns !== undefined && columns > 1);
    const style = $derived(multi ? `grid-template-columns:repeat(${columns},max-content auto)` : "");
</script>
<div class="kv" class:kv-multi={multi} {style}>
    {#each rows as row (row.id)}
        <Field {row} {onedit} diagnostics={byNode.get(row.id)} {showOffsets} />
    {/each}
</div>
