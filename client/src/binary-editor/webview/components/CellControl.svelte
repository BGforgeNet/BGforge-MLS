<script lang="ts">
    // A bare editing control for one resolved field row - the control only, no label/offset/diagnostic
    // chrome (matrix and grid cells supply their own label). Mirrors Field.svelte's control dispatch.
    import type { Row } from "@bgforge/binary-editor";
    import { controlKind } from "../state/controls";
    import NumberField from "./controls/NumberField.svelte";
    import StringField from "./controls/StringField.svelte";
    import EnumField from "./controls/EnumField.svelte";
    import FlagsField from "./controls/FlagsField.svelte";

    const { row, onedit }: {
        row: Row;
        onedit: (id: string, v: number | string) => void;
    } = $props();
    const kind = $derived(controlKind(row));
    const emit = (v: number | string) => onedit(row.id, v);
</script>
{#if kind === "number"}<NumberField {row} onedit={emit} />
{:else if kind === "string"}<StringField {row} onedit={emit} />
{:else if kind === "enum"}<EnumField {row} onedit={emit} />
{:else}<FlagsField {row} onedit={emit} />{/if}
