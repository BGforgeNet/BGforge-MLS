<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { controlKind } from "../state/controls";
    import NumberField from "./controls/NumberField.svelte";
    import StringField from "./controls/StringField.svelte";
    import EnumField from "./controls/EnumField.svelte";
    import FlagsField from "./controls/FlagsField.svelte";
    const { row, onedit }: { row: Row; onedit: (nodeId: string, value: number | string) => void } = $props();
    const kind = $derived(controlKind(row));
    const emit = (v: number | string) => onedit(row.id, v);
</script>
<div class="field">
    <span class="label" title={row.description ?? ""}>{row.name}</span>
    {#if kind === "number"}<NumberField {row} onedit={emit} />
    {:else if kind === "string"}<StringField {row} onedit={emit} />
    {:else if kind === "enum"}<EnumField {row} onedit={emit} />
    {:else}<FlagsField {row} onedit={emit} />{/if}
    {#if row.offset !== undefined}<span class="offset">0x{row.offset.toString(16)}</span>{/if}
</div>
