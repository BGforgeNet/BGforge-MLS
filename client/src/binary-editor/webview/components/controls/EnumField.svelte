<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList } from "../../state/controls";
    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const options = $derived(enumOptionList(row));
    const current = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue));
</script>
<select value={current} disabled={!row.editable} onchange={(e) => onedit(Number((e.target as HTMLSelectElement).value))}>
    {#each options as opt}
        <option value={opt.value}>{opt.label}</option>
    {/each}
</select>
