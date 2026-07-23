<script lang="ts">
    import type { LayoutMode } from "../render/compass-layout";

    // Rose/grid layout selector, shown only when a rose is constructible for the current view. The
    // caller seeds `mode` from detection on open (an FRM's tagged facings, or the IE stride-8
    // fingerprint) and this control lets the user override it. `groupCount` > 1 means the rose shows
    // one of several IE direction blocks - the group picker chooses which.
    const {
        mode,
        onModeChange,
        groupCount,
        group,
        onGroupChange,
    }: {
        mode: LayoutMode;
        onModeChange: (mode: LayoutMode) => void;
        groupCount: number; // 0 or 1 = no group picker
        group: number;
        onGroupChange: (group: number) => void;
    } = $props();

    // Group i covers cycle indices [i*8, i*8+7] - the IE 8-slot direction block (cycle-grouping.ts).
    const IE_STRIDE = 8;
</script>

<div class="view-controls" role="group" aria-label="Layout">
    <div class="view-field" role="radiogroup" aria-label="Layout mode">
        <span class="view-label">Layout</span>
        <div class="bg-options">
            <button
                type="button"
                class="bg-option"
                class:active={mode === "rose"}
                aria-pressed={mode === "rose"}
                title="Arrange directional cycles on a compass rose"
                onclick={() => onModeChange("rose")}
            >
                Rose
            </button>
            <button
                type="button"
                class="bg-option"
                class:active={mode === "grid"}
                aria-pressed={mode === "grid"}
                title="Show every cycle in a flat grid"
                onclick={() => onModeChange("grid")}
            >
                Grid
            </button>
        </div>
    </div>
    {#if mode === "rose" && groupCount > 1}
        <label
            class="view-field"
            title="This animation packs several sequences (walk, attack, ...) as consecutive direction blocks; the rose shows one block at a time"
        >
            <span class="view-label">Sequence</span>
            <select
                value={String(group)}
                onchange={(e) => {
                    const next = Number(e.currentTarget.value);
                    if (Number.isInteger(next) && next >= 0 && next < groupCount) onGroupChange(next);
                }}
                aria-label="Sequence group"
            >
                {#each Array.from({ length: groupCount }, (_, i) => i) as i (i)}
                    <option value={String(i)}>Group {i + 1} (cycles {i * IE_STRIDE}-{i * IE_STRIDE + IE_STRIDE - 1})</option>
                {/each}
            </select>
        </label>
    {/if}
</div>
