<script lang="ts">
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { controlWidthClass, showsOpenChip, thumbnailOpens } from "../state/controls";
    import CellControl from "./CellControl.svelte";
    import DocLink from "./DocLink.svelte";
    import Icon from "./Icon.svelte";
    import JumpLink from "./JumpLink.svelte";
    import OpenResourceLink from "./OpenResourceLink.svelte";
    import ResourceThumbnail from "./ResourceThumbnail.svelte";
    const { row, onedit, diagnostics = [] }:
        { row: Row; onedit: (nodeId: string, value: number | string) => void;
          diagnostics?: Diagnostic[] } = $props();
    // Width class on .field-control -> CSS maps it to the control box width (--val-ch) so the box left-aligns
    // in its `auto` grid track (columns stay aligned). Shared with GridBlock via controlWidthClass so every
    // renderer sizes the same way (see controls.ts).
    const widthClass = $derived(controlWidthClass(row));
    // A row inside an editing-locked (partially-undecoded) subtree is read-only; surface WHY on hover so a
    // disabled control is not just mysteriously greyed. Set only for the lock case (not padding/note).
    const readOnly = $derived(row.editingLocked === true);
    const labelTitle = $derived(row.description ?? "");
    // The numeric out-of-range advisory lives in NumberField (the shared numeric control, so every block
    // renderer gets it) as a value-derived indication, not here - Field only surfaces server-reported
    // diagnostics. The write-time zod gate (derive-zod.ts) stays the sole save-blocking authority.
    const allDiagnostics = $derived<Diagnostic[]>(diagnostics);
    const hasDiag = $derived(allDiagnostics.length > 0);
    const diagTitle = $derived(allDiagnostics.map((d) => d.message).join("; "));
    const firstFix = $derived(allDiagnostics.find((d) => d.quickFix));
    // Highest severity present drives the marker's icon/colour (error > warning > info). Field-level info markers
    // are not produced by the cross-record checks (orphan notes attach to group nodes), but keep this correct.
    const diagSeverity = $derived(
        allDiagnostics.some((d) => d.severity === "error")
            ? "error"
            : allDiagnostics.some((d) => d.severity === "warning")
              ? "warning"
              : "info",
    );
</script>
<div class="field">
    <!-- DocLink sits inside the label span so `.field` keeps exactly two children (the 2-column subgrid
         contract); it renders nothing unless the field carries a docUrl. -->
    <span class="label" title={labelTitle}>{row.name}<DocLink url={row.docUrl} description={row.description} /></span>
    <!-- The control and its trailing chrome (offset/diagnostic) are wrapped so .field always has exactly
         two children (label + value); the layout path makes .field a 2-column subgrid so labels share a
         max-content column and every control aligns at a uniform width. -->
    <span class="field-control {widthClass}"
          title={readOnly ? "Read-only: this field is in a region that could not be fully decoded and cannot be edited." : undefined}>
        <CellControl {row} {onedit} />
        <!-- The picture sits right after the value it renders, and IS the open affordance when the target can
             be opened - so the chip below is suppressed for exactly these rows (showsOpenChip). Its box is
             fixed, so nothing moves at runtime. -->
        {#if row.thumbnail}
            <ResourceThumbnail target={row.thumbnail} opens={thumbnailOpens(row)} />
        {/if}
        <!-- Cross-record jump (kv / detail form): a field whose value references another record - e.g. a MAP
             object's script SID pointing at the reverse-referenced object - carries `row.link`, rendered as a
             chip beside the value. Here the label names the FIELD and the target is a separate object, so a
             chip is the right affordance. The CRE item-slots GRID instead makes the slot LABEL itself the link
             (see GridBlock.svelte), because there the label names the referent ("Weapon 2" IS the linked entry).
             JumpLink renders nothing when no jump handler is in context (a view with no navigable sections). -->
        {#if showsOpenChip(row)}
            <OpenResourceLink target={row.openTarget!} />
        {/if}
        {#if row.link}
            <JumpLink link={row.link} />
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
