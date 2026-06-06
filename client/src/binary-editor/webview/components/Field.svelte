<script lang="ts">
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { controlKind } from "../state/controls";
    import NumberField from "./controls/NumberField.svelte";
    import StringField from "./controls/StringField.svelte";
    import EnumField from "./controls/EnumField.svelte";
    import FlagsField from "./controls/FlagsField.svelte";
    import Icon from "./Icon.svelte";
    const { row, onedit, diagnostics = [], showOffsets = false }:
        { row: Row; onedit: (nodeId: string, value: number | string) => void;
          diagnostics?: Diagnostic[]; showOffsets?: boolean } = $props();
    const kind = $derived(controlKind(row));
    const emit = (v: number | string) => onedit(row.id, v);
    const hasDiag = $derived(diagnostics.length > 0);
    const diagTitle = $derived(diagnostics.map((d) => d.message).join("; "));
    const firstFix = $derived(diagnostics.find((d) => d.quickFix));
</script>
<div class="field" class:field-flags={kind === "flags"}>
    <span class="label" title={row.description ?? ""}>{row.name}</span>
    {#if kind === "number"}<NumberField {row} onedit={emit} />
    {:else if kind === "string"}<StringField {row} onedit={emit} />
    {:else if kind === "enum"}<EnumField {row} onedit={emit} />
    {:else}<FlagsField {row} onedit={emit} />{/if}
    {#if showOffsets && row.offset !== undefined}
        <span class="offset" title="byte offset / size / raw value">0x{row.offset.toString(16)}{#if row.size !== undefined} +{row.size}{/if}{#if typeof row.rawValue === "number"} = 0x{(row.rawValue >>> 0).toString(16)}{/if}</span>
    {/if}
    {#if hasDiag}
        <!-- role="img" + aria-label expose the diagnostic message to screen readers; the Icon span
             itself is aria-hidden so the glyph character is not announced separately. -->
        <span class="diag warning" role="img" aria-label={diagTitle}><Icon name="warning" title={diagTitle} /></span>
        {#if firstFix}
            <button class="quick-fix" onclick={() => { for (const e of firstFix.quickFix!.edits) onedit(e.nodeId, e.value); }}>
                <Icon name="wrench" />{firstFix.quickFix!.label}
            </button>
        {/if}
    {/if}
</div>
