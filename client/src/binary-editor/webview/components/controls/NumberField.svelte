<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    // Width sized to the value's byte range, exposed as --num-ch. Multi-column and grid panels consume it so a
    // 1-byte field is a snug box instead of a 250px one (#15); single-column panels keep their fixed, aligned
    // control column (they read width from the grid track, not this var).
    const widthCh = $derived(row.size === 1 ? 6 : row.size === 2 ? 8 : row.size !== undefined && row.size >= 4 ? 12 : 8);
    function commit(e: Event) {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onedit(v);
    }
</script>
<input type="number" style="--num-ch:{widthCh}ch" value={row.rawValue ?? ""} disabled={!row.editable} onchange={commit} />
