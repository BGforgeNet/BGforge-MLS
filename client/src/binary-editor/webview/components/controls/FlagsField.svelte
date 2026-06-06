<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { decomposeFlags, composeFlags } from "../../state/controls";
    import Checkbox from "../primitives/Checkbox.svelte";

    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const bits = $derived(decomposeFlags(row));

    function toggle(mask: number, checked: boolean): void {
        const current = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0);
        onedit(composeFlags(current, mask, checked));
    }
</script>

<div class="flags-grid">
    {#each bits as b (b.mask)}
        <Checkbox
            checked={b.set}
            label={b.label}
            disabled={!row.editable}
            onchange={(checked) => toggle(b.mask, checked)}
        />
    {/each}
</div>
