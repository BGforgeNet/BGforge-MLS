<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    function commit(e: Event) {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onedit(v);
    }
</script>
<input type="number" value={row.rawValue ?? ""} disabled={!row.editable} onchange={commit} />
