<script lang="ts">
    // Key/value list of fields (label + control), optionally in N columns. Reuses Field.svelte so
    // diagnostics, offsets, and every control type come for free. Unresolved refs are skipped.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import Field from "../Field.svelte";

    const { fieldRefs, columns, fields, onedit, byNode, showOffsets = false, searchable }: {
        fieldRefs: FieldRef[];
        columns?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
        /** Field refs whose enum renders as a searchable combobox (see the layout fields block). */
        searchable?: FieldRef[];
    } = $props();

    const rows = $derived(
        fieldRefs
            .map((ref) => ({ ref, row: fields[ref] }))
            .filter((e): e is { ref: FieldRef; row: Row } => e.row !== undefined),
    );
    // Each rendered cell is a self-contained Field (label + control), so a multi-column list is N
    // max-content columns of whole Fields - not the label/value sub-columns a static kv list would use.
    const multi = $derived(columns !== undefined && columns > 1);
    const style = $derived(multi ? `grid-template-columns:repeat(${columns},max-content)` : "");
</script>
<div class="kv" class:kv-multi={multi} {style}>
    {#each rows as { ref, row } (row.id)}
        <Field {row} {onedit} diagnostics={byNode.get(row.id)} {showOffsets}
               searchable={searchable?.includes(ref) ?? false} />
    {/each}
</div>
