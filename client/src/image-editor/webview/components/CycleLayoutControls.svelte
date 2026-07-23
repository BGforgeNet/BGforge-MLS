<script lang="ts">
    // Manual grid-layout control for a multi-sequence BAM (many cycles). Since a BAM carries no
    // direction/sequence metadata, we cannot lay the cycles out correctly on our own - so the user sets
    // the column count and the flat cycle grid arranges into rows (sequences) x columns (directions).
    const {
        cycleCount,
        suggestedColumns,
        columns,
        onColumnsChange,
    }: {
        cycleCount: number;
        suggestedColumns: number;
        columns: number; // 0 = auto (flat wrap)
        onColumnsChange: (columns: number) => void;
    } = $props();
</script>

<div class="view-controls cycle-layout" role="group" aria-label="Cycle layout">
    <p class="cycle-hint">
        {cycleCount} cycles - looks like a multi-sequence animation (e.g. an IE creature: actions x directions).
        BAM stores no direction info, so lay them out manually:
    </p>
    <label class="view-field" title="Arrange the cycle grid into this many columns (0 = auto-wrap). Set it to the number of directions per sequence so each row is one sequence.">
        <span class="view-label">Columns</span>
        <input
            type="number"
            min="0"
            max="32"
            step="1"
            value={columns}
            placeholder={String(suggestedColumns)}
            onchange={(e) => {
                const next = Number(e.currentTarget.value);
                if (Number.isFinite(next) && next >= 0 && next <= 32) onColumnsChange(Math.floor(next));
            }}
            aria-label="Cycle grid columns (0 for auto)"
        />
    </label>
</div>
