<script lang="ts">
    // One flags field rendered as N vertical checkbox columns (the critter Header flags). Reuses the
    // same decompose/compose helpers as FlagsField so bit semantics match the rest of the editor.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import { decomposeFlags, composeFlags } from "../../state/controls";
    import Checkbox from "../primitives/Checkbox.svelte";

    const { field, columns = 2, descriptions, fields, onedit }: {
        field: FieldRef;
        columns?: number;
        descriptions?: Record<string, string>;
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
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
    <div class="flag-columns">
        {#each cols as col, ci (ci)}
            <div class="gcol">
                {#each col as b (b.mask)}
                    <Checkbox checked={b.set} label={b.label} title={descriptions?.[b.label]}
                              disabled={!row.editable} onchange={(checked) => toggle(b.mask, checked)} />
                {/each}
            </div>
        {/each}
    </div>
{/if}
