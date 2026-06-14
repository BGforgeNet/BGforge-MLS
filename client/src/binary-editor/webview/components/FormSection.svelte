<script lang="ts">
    import type { Diagnostic, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import { splitForm } from "../state/form-groups";
    import Field from "./Field.svelte";
    import FlagColumns from "./blocks/FlagColumns.svelte";
    import Self from "./FormSection.svelte";

    // columns: how many columns the scalar-field grid uses. Default 2; a `view: "slots"` group passes its
    // own slot count (via the group Row's `columns`) so a small fixed slot array sits on one row. Nested
    // groups render as stacked headed sections (one titled box each), not a tab strip.
    const { nodeId, bridge, version, onedit, byNode, columns = 2, hideGroupPrefix }:
        { nodeId: NodeId; bridge: Bridge; version: number;
          onedit: (id: string, v: number | string) => void;
          byNode: Map<string, Diagnostic[]>;
          columns?: number;
          // Suppress nested groups whose name starts with this prefix (e.g. "Inventory Entry") - they are
          // rendered by a sibling ChildEntryList mini-list instead, so showing them here would duplicate.
          hideGroupPrefix?: string } = $props();

    let rows = $state<Row[]>([]);
    $effect(() => {
        void version; // dependency: a bump re-fetches after the cache is cleared
        let cancelled = false;
        // Form groups are small; 1000 covers every real record. A windowed fetch for pathological cases is deferred.
        bridge.requestChildren(nodeId, 0, 1000).then((w) => { if (!cancelled) rows = w.rows; });
        return () => { cancelled = true; };
    });

    // Hidden rows (spec `hidden` flag: reserved/padding/magic fields like unused*/unknown/duplicated
    // signature-version) stay in the model for the byte round-trip but are not rendered in the form.
    const visibleRows = $derived(
        rows.filter((r) => r.hidden !== true && !(hideGroupPrefix !== undefined && r.name.startsWith(hideGroupPrefix))),
    );
    const { fields, groups } = $derived(splitForm(visibleRows));
    // Flag fields are multi-row checkbox grids; in the 2-column scalar grid their height strands the scalar
    // columns (the last left-column field ends up far below its neighbour). Keep scalars in the 2-col grid
    // and render flag fields full-width below, where their checkbox grid uses the whole width anyway.
    const scalarFields = $derived(fields.filter((f) => f.valueType !== "flags"));
    const flagFields = $derived(fields.filter((f) => f.valueType === "flags"));
    // FlagColumns looks a field up by id in a record; the detail form's flag rows are keyed by node id.
    const flagFieldMap: Record<string, Row> = $derived(Object.fromEntries(flagFields.map((r) => [r.id, r])));

    // Render a flag field as aligned vertical checkbox columns (the same FlagColumns the layout path uses),
    // not the pack-left FlagsField grid: a many-bit field like an effect's Save Type otherwise wraps raggedly
    // with no column alignment. Width scales with the bit count so a tall bitfield stays compact: a large one
    // (the MAP object's 22 ObjectFlags) gets four columns, a medium one two, and a small field stays in one
    // tidy column rather than stranded across two. (Auto-form only - layout-driven formats pass their own
    // `columns`; this heuristic affects just the MAP object / script flag fields.)
    function flagColumns(row: Row): number {
        const n = Object.keys(row.flagOptions ?? {}).length;
        return n > 12 ? 4 : n > 6 ? 2 : 1;
    }

</script>
<div class="form">
    <!-- Top-level scalar fields pack into two label/value columns (same subgrid as multi-column panels) so a
         detail pane doesn't waste the right half on a single tall column. Nested groups below span full width. -->
    {#if scalarFields.length > 0}
        <!-- style: directive (not a static style attribute) compiles to el.style.setProperty, which the
             webview CSP allows; a literal style="..." attribute would be blocked by style-src. -->
        <div class="kv kv-multi form-fields" style:grid-template-columns="repeat({columns}, max-content auto)">
            {#each scalarFields as row (row.id)}
                <Field {row} {onedit} diagnostics={byNode.get(row.id)} />
            {/each}
        </div>
    {/if}
    {#if flagFields.length > 0}
        <div class="form-flags">
            {#each flagFields as row (row.id)}
                <FlagColumns field={row.id} columns={flagColumns(row)} boxed fields={flagFieldMap} {onedit} />
            {/each}
        </div>
    {/if}
    {#each groups as group (group.id)}
        <div class="subgroup">
            <h4 class="subgroup-title">{group.name}</h4>
            <Self nodeId={group.id} {bridge} {version} {onedit} {byNode} columns={group.columns ?? 2} />
        </div>
    {/each}
</div>
