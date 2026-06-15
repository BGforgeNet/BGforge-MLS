<script lang="ts">
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { controlKind, valueTier, dropdownWidth } from "../state/controls";
    import CellControl from "./CellControl.svelte";
    import Icon from "./Icon.svelte";
    import { useJump } from "../state/jump-context";
    const { row, onedit, diagnostics = [] }:
        { row: Row; onedit: (nodeId: string, value: number | string) => void;
          diagnostics?: Diagnostic[] } = $props();
    const kind = $derived(controlKind(row));
    // Cross-record jump: a field whose value references another record (e.g. a MAP script Owner ID -> its
    // object) carries `row.link`. When a jump handler is provided (MAP), render a click-to-navigate chip
    // showing the target label; other formats/views have no handler and render nothing.
    const jump = useJump();
    // Width class on .field-control -> CSS maps it to the control box width (--val-ch) so the box left-aligns
    // in its `auto` grid track (columns stay aligned). Text inputs use the `tier-{s,m,ml,l}` scale; dropdowns
    // use their own `dd-{1..5}` scale (sized to the longest option, decoupled from the text tiers - see
    // controls.ts). Flag grids are full-width, not sized, so they get no class.
    const widthClass = $derived(
        kind === "flags" ? "" : kind === "enum" ? dropdownWidth(row) : `tier-${valueTier(row)}`,
    );
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
<div class="field">
    <span class="label" title={row.description ?? ""}>{row.name}</span>
    <!-- The control and its trailing chrome (offset/diagnostic) are wrapped so .field always has exactly
         two children (label + value); the layout path makes .field a 2-column subgrid so labels share a
         max-content column and every control aligns at a uniform width. -->
    <span class="field-control {widthClass}">
        <CellControl {row} {onedit} />
        {#if row.link && jump}
            {@const link = row.link}
            <button type="button" class="jump-link" title={`Go to ${link.label}`} onclick={() => jump(link)}>
                <span class="jump-arrow" aria-hidden="true">-&gt;</span>{link.label}
            </button>
        {/if}
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
