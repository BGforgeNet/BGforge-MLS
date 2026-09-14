<script lang="ts">
    // One flags field rendered as N vertical checkbox columns (the critter Header flags). Reuses the
    // shared decompose/compose helpers (state/controls.ts) so bit semantics match the rest of the editor.
    import type { Diagnostic, FieldRef, Row } from "@bgforge/binary-editor";
    import { decomposeFlags, composeFlags, readOnlyTitle } from "../../state/controls";
    import Checkbox from "../../../../webview-ui/Checkbox.svelte";
    import DocLink from "../DocLink.svelte";
    import FieldAffordances from "../FieldAffordances.svelte";

    // `boxed`: wrap the checkboxes in a titled group box (the field's display name as legend). Set when the
    // flags share a panel with other blocks, so the bitfield reads as one labelled set - matching the
    // detail-form flag boxes. Sole-in-titled-panel flags pass boxed=false and lean on the panel chrome
    // (its border + h3) as the group box, avoiding a redundant inner border.
    const { field, columns = 2, descriptions, labels, fields, onedit, byNode, boxed = false, spread = false }: {
        field: FieldRef;
        columns?: number;
        descriptions?: Record<string, string>;
        // Display-label override keyed by canonical flag name (b.label). Display only - the mask drives the
        // toggle and the canonical name still keys descriptions, so the round-trip identity is unchanged.
        labels?: Record<string, string>;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        // Only a boxed block draws the field's name, so only it needs the diagnostics to mark beside it.
        byNode?: Map<string, Diagnostic[]>;
        boxed?: boolean;
        // Spread columns edge-to-edge across the panel width (wide full-width flag panels) instead of clumping left.
        spread?: boolean;
    } = $props();

    const row = $derived(fields[field]);
    const bits = $derived(row ? decomposeFlags(row) : []);
    // Split the bit list into `columns` near-equal vertical runs, filling column 0 first.
    const perCol = $derived(Math.ceil(bits.length / columns));
    const cols = $derived(
        Array.from({ length: columns }, (_, c) => bits.slice(c * perCol, (c + 1) * perCol)).filter((c) => c.length > 0),
    );

    function toggle(mask: number, checked: boolean): void {
        if (!row) return;
        const current = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0);
        onedit(row.id, composeFlags(current, mask, checked));
    }
</script>
{#if row}
    <fieldset class="flag-group" class:bare={!boxed} class:spread title={readOnlyTitle(row)}>
        <!-- Bare, the enclosing title names the field, and the renderer drawing that title draws these too. -->
        {#if boxed}
            <legend title={row.description}>{row.name}<DocLink url={row.docUrl} description={row.description} /><FieldAffordances {row} {onedit} diagnostics={byNode?.get(row.id)} compact /></legend>
        {/if}
        <div class="flag-columns" class:spread>
            {#each cols as col, ci (ci)}
                <div class="gcol">
                    {#each col as b (b.mask)}
                        <Checkbox checked={b.set} label={labels?.[b.label] ?? b.label} title={descriptions?.[b.label]}
                                  disabled={!row.editable} onchange={(checked) => toggle(b.mask, checked)} />
                    {/each}
                </div>
            {/each}
        </div>
    </fieldset>
{/if}
