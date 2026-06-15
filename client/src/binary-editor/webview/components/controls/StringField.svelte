<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    const { row, onedit }: { row: Row; onedit: (value: string) => void } = $props();
</script>
<input type="text" value={row.displayValue ?? ""} disabled={!row.editable}
       onchange={(e) => onedit((e.target as HTMLInputElement).value)} />
