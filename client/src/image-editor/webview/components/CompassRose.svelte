<script lang="ts">
    import type { AnimationView } from "../messages";
    import type { Background } from "../render/indexed-to-rgba";
    import { layoutSequences } from "../render/compass-layout";
    import { TILE_BASE_PX } from "../render/tile";
    import FrameCanvas from "./FrameCanvas.svelte";

    const {
        view,
        frame,
        zoom,
        background,
        showOffsetMarker = false,
    }: {
        view: AnimationView;
        frame: number;
        zoom: number;
        background: Background;
        showOffsetMarker?: boolean;
    } = $props();

    // Recomputed from `view` (not passed a pre-computed layout): compass-layout.ts is a cheap pure
    // function, and CompassRose only ever mounts when the caller has already decided mode === "compass".
    const tiles = $derived.by(() => {
        const layout = layoutSequences(view);
        return layout.mode === "compass" ? layout.tiles : [];
    });

    // Tiles sit on a circle of this radius (in tile-widths) around the rose centre. 1.5 keeps the
    // 45-degree-adjacent tiles (e.g. E and NE) from overlapping while staying compact.
    const RADIUS_TILES = 1.5;
    const tilePx = $derived(TILE_BASE_PX * zoom);
    const radiusPx = $derived(tilePx * RADIUS_TILES);
    // Square box big enough for a tile centred at the far edge of the circle: 2*radius + one tile.
    const rosePx = $derived(radiusPx * 2 + tilePx);
</script>

<!-- Radial layout (not a grid): each facing sits at its true compass angle so FRM's 6 facings render
     as a hexagon (no N/S) and 8 as an octagon - a real rose, not two columns. See compass-layout.ts. -->
<div class="compass-rose" style:width="{rosePx}px" style:height="{rosePx}px">
    {#each tiles as tile (tile.seq.facing)}
        {@const clampedIndex = Math.min(frame, tile.seq.frameRefs.length - 1)}
        {@const frameRef = tile.seq.frameRefs[clampedIndex]}
        {@const frameView = frameRef === undefined ? undefined : view.frames[frameRef]}
        <div
            class="compass-cell"
            style:left="calc(50% + {tile.pos.dx * radiusPx}px)"
            style:top="calc(50% + {tile.pos.dy * radiusPx}px)"
        >
            {#if frameView}
                <FrameCanvas
                    frame={frameView}
                    palette={view.palette}
                    transparentIndex={view.meta.transparentIndex ?? 0}
                    {zoom}
                    {background}
                    sourceFormat={view.sourceFormat}
                    dirOffsetX={tile.seq.dirOffsetX}
                    dirOffsetY={tile.seq.dirOffsetY}
                    {showOffsetMarker}
                />
            {/if}
        </div>
    {/each}
</div>
