<script lang="ts">
    // A run of numeric fields folded into one labelled inline row: "Label  [a] / [b] / [c]". Used by the
    // declarative layout (fields block `joins`) for compact scalar tuples - e.g. CRE multiclass Level - where
    // one full row per field wastes space. Reuses NumberField so editing/commit behaviour matches every other
    // numeric control; only the box is smaller and the per-field labels collapse into the shared one.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import NumberField from "./controls/NumberField.svelte";

    const { label, fieldRefs, separator = " / ", fields, onedit }: {
        label: string;
        fieldRefs: FieldRef[];
        // One string between every pair, or an array of per-gap separators (e.g. ["d", "+"] -> XdY+Z).
        separator?: string | string[];
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
    } = $props();

    const rows = $derived(fieldRefs.map((ref) => fields[ref]).filter((r): r is Row => r !== undefined));
    // Separator before the i-th input (i > 0): index a per-gap array by gap, or repeat a plain string.
    const sepBefore = (i: number): string => (Array.isArray(separator) ? (separator[i - 1] ?? "") : separator);
</script>
<div class="field">
    <span class="label">{label}</span>
    <span class="field-control joined">
        {#each rows as row, i (row.id)}
            {#if i > 0}<span class="joined-sep">{sepBefore(i)}</span>{/if}
            <span class="joined-input"><NumberField {row} onedit={(v) => onedit(row.id, v)} /></span>
        {/each}
    </span>
</div>
