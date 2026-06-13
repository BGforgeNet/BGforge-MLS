<script lang="ts">
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { controlKind, valueTier, dropdownWidth } from "../state/controls";
    import NumberField from "./controls/NumberField.svelte";
    import StringField from "./controls/StringField.svelte";
    import EnumField from "./controls/EnumField.svelte";
    import FlagsField from "./controls/FlagsField.svelte";
    import Icon from "./Icon.svelte";
    const { row, onedit, diagnostics = [] }:
        { row: Row; onedit: (nodeId: string, value: number | string) => void;
          diagnostics?: Diagnostic[] } = $props();
    const kind = $derived(controlKind(row));
    // Width class on .field-control -> CSS maps it to the control box width (--val-ch) so the box left-aligns
    // in its `auto` grid track (columns stay aligned). Text inputs use the `tier-{s,m,ml,l}` scale; dropdowns
    // use their own `dd-{1..5}` scale (sized to the longest option, decoupled from the text tiers - see
    // controls.ts). Flag grids are full-width, not sized, so they get no class.
    const widthClass = $derived(
        kind === "flags" ? "" : kind === "enum" ? dropdownWidth(row) : `tier-${valueTier(row)}`,
    );
    const emit = (v: number | string) => onedit(row.id, v);
    const hasDiag = $derived(diagnostics.length > 0);
    const diagTitle = $derived(diagnostics.map((d) => d.message).join("; "));
    const firstFix = $derived(diagnostics.find((d) => d.quickFix));
    // Highest severity present drives the marker's icon/colour (error > warning > info). Field-level info markers
    // are not produced by the cross-record checks (orphan notes attach to group nodes), but keep this correct.
    const diagSeverity = $derived(
        diagnostics.some((d) => d.severity === "error")
            ? "error"
            : diagnostics.some((d) => d.severity === "warning")
              ? "warning"
              : "info",
    );
</script>
<div class="field" class:field-flags={kind === "flags"}>
    <span class="label" title={row.description ?? ""}>{row.name}</span>
    <!-- The control and its trailing chrome (offset/diagnostic) are wrapped so .field always has exactly
         two children (label + value); the layout path makes .field a 2-column subgrid so labels share a
         max-content column and every control aligns at a uniform width. -->
    <span class="field-control {widthClass}">
        {#if kind === "number"}<NumberField {row} onedit={emit} />
        {:else if kind === "string"}<StringField {row} onedit={emit} />
        {:else if kind === "enum"}<EnumField {row} onedit={emit} />
        {:else}<FlagsField {row} onedit={emit} />{/if}
        {#if hasDiag}
            <!-- role="img" + aria-label expose the diagnostic message to screen readers; the Icon span
                 itself is aria-hidden so the glyph character is not announced separately. -->
            <span class="diag {diagSeverity}" role="img" aria-label={diagTitle}><Icon name={diagSeverity === "info" ? "info" : "warning"} title={diagTitle} /></span>
            {#if firstFix}
                <button class="quick-fix" onclick={() => { for (const e of firstFix.quickFix!.edits) onedit(e.nodeId, e.value); }}>
                    <Icon name="wrench" />{firstFix.quickFix!.label}
                </button>
            {/if}
        {/if}
    </span>
</div>
