<script lang="ts">
    import type { AnimationView } from "../messages";
    import { type RoseTile, roseGeometry } from "../render/compass-layout";
    import type { TileBox } from "../render/anchor";
    import SequenceTile from "./SequenceTile.svelte";

    // Presentational: the caller (App) owns the layout decision and tile derivation - the same view can
    // yield different roses (an FRM's tagged facings, or one direction block of an IE-interpreted BAM).
    const {
        view,
        loadedPixels,
        tiles,
        frame,
        layoutScale,
        spriteScale,
        tileBox,
        showOffsetMarker = false,
    }: {
        view: AnimationView;
        loadedPixels: ReadonlyMap<number, Uint8Array>;
        tiles: RoseTile[];
        frame: number;
        layoutScale: number;
        spriteScale: number;
        tileBox: TileBox;
        showOffsetMarker?: boolean;
    } = $props();

    // Radius and box both depend on which facings are present - see roseGeometry.
    const geometry = $derived(roseGeometry(tiles));
    const cellW = $derived(tileBox.w * layoutScale);
    const cellH = $derived(tileBox.h * layoutScale);
    // The wheel stays a CIRCLE on a rectangular tile: spacing it by each axis separately would put the
    // facings on an ellipse, at angles that are no longer the compass angles the layout exists to show.
    // So one spacing for both axes, the larger side - which is what keeps neighbouring tiles from
    // overlapping whichever way round the tile is.
    const spacingPx = $derived(Math.max(cellW, cellH));
</script>

<!-- Radial layout (not a grid): each facing sits at its true compass angle so FRM's 6 facings render
     as a hexagon (no N/S), 8 as an octagon, and a stored western arc as the half-wheel the file
     actually holds - a real rose, not two columns. See compass-layout.ts. -->
<!-- The box spans the wheel's own spacing, then the half-tile each edge cell overhangs it by. -->
<div
    class="compass-rose"
    style:width="{(geometry.widthTiles - 1) * spacingPx + cellW}px"
    style:height="{(geometry.heightTiles - 1) * spacingPx + cellH}px"
>
    {#each tiles as tile, i (tile.facing)}
        <!-- Each cell is centred on its compass point, so a rectangular tile hangs by its own half-widths
             rather than by the spacing's. -->
        <div
            class="compass-cell"
            style:left="{(geometry.centers[i]?.x ?? 0) * spacingPx - cellW / 2}px"
            style:top="{(geometry.centers[i]?.y ?? 0) * spacingPx - cellH / 2}px"
        >
            <SequenceTile
                {view}
                {loadedPixels}
                seq={tile.seq}
                facing={tile.facing}
                {frame}
                {layoutScale}
                {spriteScale}
                {tileBox}
                {showOffsetMarker}
            />
        </div>
    {/each}
</div>
