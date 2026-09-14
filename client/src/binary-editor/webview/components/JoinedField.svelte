<script lang="ts">
    // A run of numeric fields folded into one labelled inline row: "Label  [a] / [b] / [c]". Used by the
    // declarative layout (fields block `joins`) for compact scalar tuples - e.g. CRE multiclass Level - where
    // one full row per field wastes space. Each part is a compact CellControl: a small fixed box, like a matrix
    // cell, so the per-field labels collapse into the shared one and a strref line moves to the tooltip.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import { readOnlyTitle } from "../state/controls";
    import CellControl from "./CellControl.svelte";
    import DocLink from "./DocLink.svelte";
    import FieldAffordances from "./FieldAffordances.svelte";

    const { label, fieldRefs, separator = " / ", fields, onedit, byNode }: {
        label: string;
        fieldRefs: FieldRef[];
        // One string between every pair, or an array of per-gap separators (e.g. ["d", "+"] -> XdY+Z).
        separator?: string | string[];
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
    } = $props();

    const rows = $derived(fieldRefs.map((ref) => fields[ref]).filter((r): r is Row => r !== undefined));
    // Separator before the i-th input (i > 0): index a per-gap array by gap, or repeat a plain string.
    const sepBefore = (i: number): string => (Array.isArray(separator) ? (separator[i - 1] ?? "") : separator);
    // The shared label names the run, not any one part, so each part's description follows it in the tooltip.
    const labelTitle = $derived([label, ...rows.flatMap((row) => (row.description ? [row.description] : []))].join("\n"));
</script>
<div class="field">
    <span class="label" title={labelTitle}>{label}{#each rows as row (row.id)}<DocLink url={row.docUrl} description={row.description} />{/each}</span>
    <span class="field-control joined">
        <span class="joined-run">
            {#each rows as row, i (row.id)}
                {#if i > 0}<span class="joined-sep">{sepBefore(i)}</span>{/if}
                <span class="joined-input" title={readOnlyTitle(row)}><CellControl {row} {onedit} compact /></span>
            {/each}
        </span>
        <!-- After the whole run, so a marker appearing never moves one of its inputs. -->
        {#each rows as row (row.id)}
            <FieldAffordances {row} {onedit} diagnostics={byNode.get(row.id)} compact />
        {/each}
    </span>
</div>
