<script lang="ts">
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { controlWidthClass, rangeTooltip } from "../state/controls";
    import CellControl from "./CellControl.svelte";
    import Icon from "./Icon.svelte";
    import JumpLink from "./JumpLink.svelte";
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
    // Advisory range hint appended to the existing description tooltip (never replacing it).
    const rangeText = $derived(rangeTooltip(row));
    const labelTitle = $derived(
        rangeText ? `${row.description ?? ""}${row.description ? " " : ""}(range ${rangeText})` : (row.description ?? ""),
    );
    // Immediate client-side advisory for an out-of-range keystroke, reported by NumberField via
    // onlocalinvalid. Folded into the SAME diagnostic icon a server-reported diagnostic uses, rather than a
    // second error UI. The write-time zod gate (derive-zod.ts) stays the sole save-blocking authority.
    let localRangeError = $state<string | undefined>();
    // Clear the local advisory once fresh row data lands (a commit round trip, undo/redo, or a host-pushed
    // update) - from that point the server's own `diagnostics` prop is authoritative, and a stale local
    // message must not keep showing over a value that has since changed underneath it.
    $effect(() => {
        void row.rawValue;
        localRangeError = undefined;
    });
    const allDiagnostics = $derived<Diagnostic[]>(
        localRangeError !== undefined
            ? [...diagnostics, { nodeId: row.id, severity: "warning", message: localRangeError }]
            : diagnostics,
    );
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
    <span class="label" title={labelTitle}>{row.name}</span>
    <!-- The control and its trailing chrome (offset/diagnostic) are wrapped so .field always has exactly
         two children (label + value); the layout path makes .field a 2-column subgrid so labels share a
         max-content column and every control aligns at a uniform width. -->
    <span class="field-control {widthClass}"
          title={readOnly ? "Read-only: this field is in a region that could not be fully decoded and cannot be edited." : undefined}>
        <CellControl {row} {onedit} onlocalinvalid={(m) => (localRangeError = m)} />
        <!-- Cross-record jump: a field whose value references another record (e.g. a MAP script Owner ID ->
             its object, a CRE item slot -> its Items entry) carries `row.link`. JumpLink renders nothing when
             no jump handler is in context (a view with no navigable sections). -->
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
