<script lang="ts">
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { controlWidthClass, readOnlyTitle } from "../state/controls";
    import CellControl from "./CellControl.svelte";
    import DocLink from "./DocLink.svelte";
    import FieldAffordances from "./FieldAffordances.svelte";
    const { row, onedit, diagnostics = [] }:
        { row: Row; onedit: (nodeId: string, value: number | string) => void;
          diagnostics?: Diagnostic[] } = $props();
    // Width class on .field-control -> CSS maps it to the control box width (--val-ch) so the box left-aligns
    // in its `auto` grid track (columns stay aligned). Shared with GridBlock via controlWidthClass so every
    // renderer sizes the same way (see controls.ts).
    const widthClass = $derived(controlWidthClass(row));
    // The numeric out-of-range advisory lives in NumberField (the shared numeric control, so every block
    // renderer gets it) as a value-derived indication, not here - Field only surfaces server-reported
    // diagnostics. The write-time zod gate (derive-zod.ts) stays the sole save-blocking authority.
</script>
<div class="field">
    <!-- DocLink sits inside the label span so `.field` keeps exactly two children (the 2-column subgrid
         contract); it renders nothing unless the field carries a docUrl. -->
    <span class="label" title={row.description ?? ""}>{row.name}<DocLink url={row.docUrl} description={row.description} /></span>
    <!-- The control and its trailing affordances are wrapped so .field always has exactly two children
         (label + value); the layout path makes .field a 2-column subgrid so labels share a max-content column
         and every control aligns at a uniform width. -->
    <span class="field-control {widthClass}" title={readOnlyTitle(row)}>
        <CellControl {row} {onedit} />
        <!-- Cross-record jump (kv / detail form): here the label names the FIELD and the target is a separate
             object, so a chip beside the value is the affordance. The CRE item-slots GRID instead makes the slot
             LABEL itself the link (see GridBlock.svelte), because there the label names the referent. -->
        <FieldAffordances {row} {onedit} {diagnostics} />
    </span>
</div>
