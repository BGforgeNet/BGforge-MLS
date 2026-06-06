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
    // Each rendered cell is a self-contained Field (label + control), so a multi-column list is N
    // max-content columns of whole Fields - not the label/value sub-columns a static kv list would use.
    const multi = $derived(columns !== undefined && columns > 1);
    const style = $derived(multi ? `grid-template-columns:repeat(${columns},max-content)` : "");
</script>
<div class="kv" class:kv-multi={multi} {style}>
    {#each rows as row (row.id)}
        <Field {row} {onedit} diagnostics={byNode.get(row.id)} {showOffsets} />
    {/each}
</div>
