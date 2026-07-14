<script lang="ts">
    // Bare editing control for one resolved field row - the control only, no label/offset/diagnostic chrome.
    // The single place that maps a field's controlKind to its input component: Field.svelte wraps this with a
    // label + diagnostics, and the grid/matrix cells use it directly (they supply their own label).
    import type { Row } from "@bgforge/binary-editor";
    import { controlKind } from "../state/controls";
    import NumberField from "./controls/NumberField.svelte";
    import StringField from "./controls/StringField.svelte";
    import EnumField from "./controls/EnumField.svelte";
    import FlagColumns from "./blocks/FlagColumns.svelte";

    const { row, onedit, onlocalinvalid }: {
        row: Row;
        onedit: (id: string, v: number | string) => void;
        onlocalinvalid?: (message: string | undefined) => void;
    } = $props();
    const kind = $derived(controlKind(row));
    const emit = (v: number | string) => onedit(row.id, v);
    // A flags field is normally diverted upstream (a dedicated flags/flagGroups block, or FormSection's
    // valueType split) to FlagColumns, so the flags branch here is a defensive fallback - render it through
    // the SAME FlagColumns the rest of the editor uses, as a one-field record keyed by the field's own id.
    const flagFields = $derived<Record<string, Row>>({ [row.id]: row });
</script>
{#if kind === "number"}<NumberField {row} onedit={emit} {onlocalinvalid} />
{:else if kind === "string"}<StringField {row} onedit={emit} />
{:else if kind === "enum"}<EnumField {row} onedit={emit} />
{:else}<FlagColumns field={row.id} fields={flagFields} columns={1} boxed={false} {onedit} />{/if}
