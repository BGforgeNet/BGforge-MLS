<script lang="ts">
    import type { AnimationView } from "../messages";
    import type { GridTile } from "../render/compass-layout";
    import SequenceTile from "./SequenceTile.svelte";

    // Presentational: the caller (App) owns the layout decision and tile derivation - the grid can hold
    // every cycle (untagged BAM, or a rose-capable view the user flipped to grid) or a collapsed single
    // tile (single-orientation FRM).
    const {
        view,
        tiles,
        frame,
        zoom,
        tileBase,
        showOffsetMarker = false,
        columns = 0,
    }: {
        view: AnimationView;
        tiles: GridTile[];
        frame: number;
        zoom: number;
        tileBase: number;
        showOffsetMarker?: boolean;
        columns?: number; // >0 pins the grid to that many columns (rows=sequences); 0 = auto-wrap
    } = $props();
</script>

<div
    class="cycle-grid"
    class:fixed-columns={columns > 0}
    style={columns > 0 ? `grid-template-columns: repeat(${columns}, auto)` : undefined}
>
    {#each tiles as tile (tile.index)}
        <div class="cycle-cell">
            <SequenceTile {view} seq={tile.seq} {frame} {zoom} {tileBase} {showOffsetMarker} />
            {#if tiles.length > 1}
                <!-- A lone cell (single-orientation FRM, or a single-cycle animation) needs no label -
                     there is nothing to distinguish it from. -->
                <span class="cycle-cell-label">{tile.seq.facing === "none" ? `Cycle ${tile.index}` : tile.seq.facing}</span>
            {/if}
        </div>
    {/each}
</div>
