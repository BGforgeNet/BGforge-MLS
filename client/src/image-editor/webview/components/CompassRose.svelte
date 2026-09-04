<script lang="ts">
    import type { AnimationView } from "../messages";
    import { type RoseTile, roseGeometry } from "../render/compass-layout";
    import SequenceTile from "./SequenceTile.svelte";

    // Presentational: the caller (App) owns the layout decision and tile derivation - the same view can
    // yield different roses (an FRM's tagged facings, or one direction block of an IE-interpreted BAM).
    const {
        view,
        loadedPixels,
        tiles,
        frame,
        zoom,
        tileBase,
        showOffsetMarker = false,
    }: {
        view: AnimationView;
        loadedPixels: ReadonlyMap<number, Uint8Array>;
        tiles: RoseTile[];
        frame: number;
        zoom: number;
        tileBase: number;
        showOffsetMarker?: boolean;
    } = $props();

    // Radius and box both depend on which facings are present - see roseGeometry.
    const tilePx = $derived(tileBase * zoom);
    const geometry = $derived(roseGeometry(tiles));
</script>

<!-- Radial layout (not a grid): each facing sits at its true compass angle so FRM's 6 facings render
     as a hexagon (no N/S), 8 as an octagon, and a stored western arc as the half-wheel the file
     actually holds - a real rose, not two columns. See compass-layout.ts. -->
<div
    class="compass-rose"
    style:width="{geometry.widthTiles * tilePx}px"
    style:height="{geometry.heightTiles * tilePx}px"
>
    {#each tiles as tile, i (tile.facing)}
        <div
            class="compass-cell"
            style:left="{(geometry.centers[i]?.x ?? 0) * tilePx - tilePx / 2}px"
            style:top="{(geometry.centers[i]?.y ?? 0) * tilePx - tilePx / 2}px"
        >
            <SequenceTile
                {view}
                {loadedPixels}
                seq={tile.seq}
                facing={tile.facing}
                {frame}
                {zoom}
                {tileBase}
                {showOffsetMarker}
            />
        </div>
    {/each}
</div>
