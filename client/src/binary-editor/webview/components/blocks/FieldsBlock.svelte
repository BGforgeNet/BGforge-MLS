<script lang="ts">
    // Key/value list of fields (label + control), optionally in N columns. Reuses Field.svelte so
    // diagnostics, offsets, and every control type come for free. Unresolved refs are skipped.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import Field from "../Field.svelte";
    import JoinedField from "../JoinedField.svelte";

    const { fieldRefs, columns, fields, onedit, byNode, joins, labelReserve }: {
        fieldRefs: FieldRef[];
        columns?: number;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        // Runs of fields folded into one labelled inline row (see the layout `joins` schema).
        joins?: { label: string; fields: FieldRef[]; separator: string }[];
        // Reserve a minimum label width (ch) for ONLY the columns containing these fields - keeps a rewritten
        // label's column from jumping while the static columns beside it hug their labels (see schema). Each ref
        // carries its own `ch`; a column floors to the max `ch` among its reserved fields.
        labelReserve?: { fields: { ref: FieldRef; ch: number }[] };
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
    const renderedRefs = $derived(fieldRefs.filter((ref) => !folded.has(ref)));
    const rows = $derived(multi ? Math.ceil(renderedRefs.length / (columns ?? 1)) : 0);
    // Per-column label track: `max-content` (hugs the column's widest static label), EXCEPT a column holding a
    // reserved (runtime-rewritten) field gets `minmax(<ch>ch,max-content)` - floored so that column's value
    // does not jump as its label changes, while every other column stays tight to its own short labels. Items
    // fill column-major (`grid-auto-flow:column`, `rows` per column), so column c holds renderedRefs[c*rows..].
    const reserveByRef = $derived(new Map((labelReserve?.fields ?? []).map((f) => [f.ref, f.ch])));
    const labelTracks = $derived(
        Array.from({ length: columns ?? 1 }, (_unused, c) => {
            let maxCh = 0;
            for (const ref of renderedRefs.slice(c * rows, c * rows + rows)) maxCh = Math.max(maxCh, reserveByRef.get(ref) ?? 0);
            return maxCh > 0 ? `minmax(${maxCh}ch,max-content)` : "max-content";
        }),
    );
    const style = $derived(
        multi
            ? `grid-template-columns:${labelTracks.map((t) => `${t} auto`).join(" ")};grid-auto-flow:column;grid-template-rows:repeat(${rows},auto)`
            : "",
    );
</script>
<div class="kv" class:kv-multi={multi} {style}>
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
