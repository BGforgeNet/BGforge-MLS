<script lang="ts">
    import type { AnimationView } from "../messages";
    import type { Background } from "../render/indexed-to-rgba";
    import { layoutSequences } from "../render/compass-layout";
    import SequenceTile from "./SequenceTile.svelte";

    const {
        view,
        frame,
        zoom,
        background,
        showOffsetMarker = false,
        columns = 0,
    }: {
        view: AnimationView;
        frame: number;
        zoom: number;
        background: Background;
        showOffsetMarker?: boolean;
        columns?: number; // >0 pins the grid to that many columns (rows=sequences); 0 = auto-wrap
    } = $props();

    // The grid fallback: non-directional animations, or duplicate facings that cannot share a compass
    // cell. Recomputed from `view` for the same reason as CompassRose (a cheap pure function).
    const tiles = $derived.by(() => {
        const layout = layoutSequences(view);
        return layout.mode === "grid" ? layout.tiles : [];
    });
</script>

<div
    class="cycle-grid"
    class:fixed-columns={columns > 0}
    style={columns > 0 ? `grid-template-columns: repeat(${columns}, auto)` : undefined}
>
    {#each tiles as tile (tile.index)}
        <div class="cycle-cell">
            <SequenceTile {view} seq={tile.seq} {frame} {zoom} {background} {showOffsetMarker} />
            {#if tiles.length > 1}
                <!-- A lone cell (single-orientation FRM, or a single-cycle animation) needs no label -
                     there is nothing to distinguish it from. -->
                <span class="cycle-cell-label">{tile.seq.facing === "none" ? `Cycle ${tile.index}` : tile.seq.facing}</span>
            {/if}
        </div>
    {/each}
</div>
