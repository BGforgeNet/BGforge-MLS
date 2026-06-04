<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { decomposeFlags, composeFlags } from "../../state/controls";
    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const bits = $derived(decomposeFlags(row));
    function toggle(bit: number, checked: boolean) {
        const current = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0);
        onedit(composeFlags(current, bit, checked));
    }
</script>
<div class="flags">
    {#each bits as b}
        <label><input type="checkbox" checked={b.set} disabled={!row.editable}
            onchange={(e) => toggle(b.bit, (e.target as HTMLInputElement).checked)} /> {b.label}</label>
    {/each}
</div>
