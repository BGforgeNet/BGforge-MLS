<script lang="ts">
    // Key/value list of fields (label + control), optionally in N columns. Reuses Field.svelte so
    // diagnostics, offsets, and every control type come for free. Unresolved refs are skipped.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import Field from "../Field.svelte";
    import JoinedField from "../JoinedField.svelte";

    const { fieldRefs, columns, fields, onedit, byNode, joins, labelWidthCh }: {
        fieldRefs: FieldRef[];
        columns?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        // Runs of fields folded into one labelled inline row (see the layout `joins` schema).
        joins?: { label: string; fields: FieldRef[]; separator: string }[];
        // Fixed label-column width (ch) - stable columns where labels are rewritten at runtime (see schema).
        labelWidthCh?: number;
    } = $props();

    // Multi-column list: each column is a (label, value) pair of tracks - `max-content` so the label hugs
    // its text (shared per column, so values still align vertically), `auto` for the control. Each Field is
    // a subgrid spanning its pair, so short labels no longer sit in a fixed-width box far from their value.
    const multi = $derived(columns !== undefined && columns > 1);
    // A join folds a run of fields into one inline row at the FIRST member's position; the rest are folded in
    // (skipped in the normal flow). Iterate refs (not resolved rows) so the join anchors line up with `fields`.
    const joinByAnchor = $derived(new Map((joins ?? []).map((j) => [j.fields[0], j])));
    const folded = $derived(new Set((joins ?? []).flatMap((j) => j.fields.slice(1))));
    // Fill column-major (top-down first): column 1 takes the first `rows` items, then column 2, etc. - so
    // reading order runs down each column, matching the flag grids. `grid-auto-flow:column` + a fixed row
    // count drives the placement; the row count is the rendered item count (refs minus folded join members)
    // divided across the columns. The default row flow would instead snake left-to-right across rows.
    const rendered = $derived(fieldRefs.filter((ref) => !folded.has(ref)).length);
    const rows = $derived(multi ? Math.ceil(rendered / (columns ?? 1)) : 0);
    // Label track: fixed `<labelWidthCh>ch` when given (stable columns despite runtime label rewrites), else
    // `max-content` (hugs the widest current label - fine for static labels).
    const labelTrack = $derived(labelWidthCh !== undefined ? `${labelWidthCh}ch` : "max-content");
    const style = $derived(
        multi
            ? `grid-template-columns:repeat(${columns},${labelTrack} auto);grid-auto-flow:column;grid-template-rows:repeat(${rows},auto)`
            : "",
    );
</script>
<div class="kv" class:kv-multi={multi} class:kv-fixed-label={labelWidthCh !== undefined} {style}>
    {#each fieldRefs as ref (ref)}
        {@const join = joinByAnchor.get(ref)}
        {#if join}
            <JoinedField label={join.label} fieldRefs={join.fields} separator={join.separator} {fields} {onedit} />
        {:else if !folded.has(ref)}
            {@const row = fields[ref]}
            {#if row}
                <Field {row} {onedit} diagnostics={byNode.get(row.id)} />
            {/if}
        {/if}
    {/each}
</div>
