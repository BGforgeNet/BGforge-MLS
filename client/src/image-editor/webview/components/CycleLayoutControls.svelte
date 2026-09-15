<script lang="ts">
    // Grid-layout control for a multi-sequence BAM (many cycles): the user sets the column count and the
    // flat cycle grid arranges into rows (sequences) x columns (directions). The hint says where the
    // suggested count came from - a reading of the file's block structure, or a guess - so the panel does
    // not tell the reader to work out a layout it has already resolved and is showing them.
    import { cycleGridHint, type CycleGridAnalysis } from "../render/cycle-grouping";

    const {
        cycleCount,
        analysis,
        columns,
        onColumnsChange,
    }: {
        cycleCount: number;
        analysis: CycleGridAnalysis;
        columns: number; // 0 = auto (flat wrap)
        onColumnsChange: (columns: number) => void;
    } = $props();
</script>

<div class="view-controls" role="group" aria-label="Cycle layout">
    <p class="cycle-hint">{cycleGridHint(cycleCount, analysis)}</p>
    <label class="view-field" title="Arrange the cycle grid into this many columns (0 = auto-wrap). Set it to the number of directions per sequence so each row is one sequence.">
        <span class="view-label">Columns</span>
        <input
            type="number"
            min="0"
            max="32"
            step="1"
            value={columns}
            placeholder={String(analysis.suggestedColumns)}
            onchange={(e) => {
                const next = Number(e.currentTarget.value);
                if (Number.isFinite(next) && next >= 0 && next <= 32) onColumnsChange(Math.floor(next));
            }}
            aria-label="Cycle grid columns (0 for auto)"
        />
    </label>
</div>
