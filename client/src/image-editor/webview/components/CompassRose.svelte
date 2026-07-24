<script lang="ts">
    import type { AnimationView } from "../messages";
    import type { RoseTile } from "../render/compass-layout";
    import SequenceTile from "./SequenceTile.svelte";

    // Presentational: the caller (App) owns the layout decision and tile derivation - the same view can
    // yield different roses (an FRM's tagged facings, or one direction block of an IE-interpreted BAM).
    const {
        view,
        tiles,
        frame,
        zoom,
        tileBase,
        showOffsetMarker = false,
    }: {
        view: AnimationView;
        tiles: RoseTile[];
        frame: number;
        zoom: number;
        tileBase: number;
        showOffsetMarker?: boolean;
    } = $props();

    // Tiles sit on a circle of this radius (in tile-widths) around the rose centre. 1.5 keeps the
    // 45-degree-adjacent tiles (e.g. E and NE) from overlapping while staying compact.
    const RADIUS_TILES = 1.5;
    const tilePx = $derived(tileBase * zoom);
    const radiusPx = $derived(tilePx * RADIUS_TILES);
    // Square box big enough for a tile centred at the far edge of the circle: 2*radius + one tile.
    const rosePx = $derived(radiusPx * 2 + tilePx);
</script>

<!-- Radial layout (not a grid): each facing sits at its true compass angle so FRM's 6 facings render
     as a hexagon (no N/S) and 8 as an octagon - a real rose, not two columns. See compass-layout.ts. -->
<div class="compass-rose" style:width="{rosePx}px" style:height="{rosePx}px">
    {#each tiles as tile (tile.facing)}
        <div
            class="compass-cell"
            style:left="calc(50% + {tile.pos.dx * radiusPx - tilePx / 2}px)"
            style:top="calc(50% + {tile.pos.dy * radiusPx - tilePx / 2}px)"
        >
            <SequenceTile {view} seq={tile.seq} {frame} {zoom} {tileBase} {showOffsetMarker} />
        </div>
    {/each}
</div>
