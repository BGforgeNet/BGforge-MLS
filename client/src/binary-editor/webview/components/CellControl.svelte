<script lang="ts">
    // Bare editing control for one resolved field row - the control only, no label/offset/diagnostic chrome.
    // The single place that maps a field's controlKind to its input component: Field.svelte wraps this with a
    // label + diagnostics, and the grid/matrix cells use it directly (they supply their own label).
    import type { Row } from "@bgforge/binary-editor";
    import { controlKind } from "../state/controls";
    import NumberField from "./controls/NumberField.svelte";
    import StringField from "./controls/StringField.svelte";
    import EnumField from "./controls/EnumField.svelte";
    import ResourceField from "./controls/ResourceField.svelte";
    import FlagColumns from "./blocks/FlagColumns.svelte";

    const { row, onedit, compact = false }: {
        row: Row;
        onedit: (id: string, v: number | string) => void;
        // Set by a renderer whose cells are sized to a number and cannot grow (the fixed-width matrix): a
        // resolved strref then keeps its number in the cell and moves the dialog.tlk line to the tooltip,
        // instead of overflowing a cell that has no room for it.
        compact?: boolean;
    } = $props();
    const kind = $derived(controlKind(row));
    const emit = (v: number | string) => onedit(row.id, v);
    // A flags field is normally diverted upstream (a dedicated flags/flagGroups block, or FormSection's
    // valueType split) to FlagColumns, so the flags branch here is a defensive fallback - render it through
    // the SAME FlagColumns the rest of the editor uses, as a one-field record keyed by the field's own id.
    const flagFields = $derived<Record<string, Row>>({ [row.id]: row });
</script>
{#if kind === "number"}<NumberField {row} {compact} onedit={emit} />
{:else if kind === "string"}<StringField {row} onedit={emit} />
{:else if kind === "resource"}<ResourceField {row} onedit={emit} />
{:else if kind === "enum"}<EnumField {row} onedit={emit} />
{:else}<FlagColumns field={row.id} fields={flagFields} columns={1} boxed={false} {onedit} />{/if}
