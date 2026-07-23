<script lang="ts">
    import type { AnimationView } from "../messages";
    import type { Background } from "../render/indexed-to-rgba";
    import { layoutSequences } from "../render/compass-layout";
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

    // The grid fallback: non-directional animations, or duplicate facings that cannot share a compass
    // cell. Recomputed from `view` for the same reason as CompassRose (a cheap pure function).
    const tiles = $derived.by(() => {
        const layout = layoutSequences(view);
        return layout.mode === "grid" ? layout.tiles : [];
    });
</script>

<div class="cycle-grid">
    {#each tiles as tile (tile.index)}
        {@const clampedIndex = Math.min(frame, tile.seq.frameRefs.length - 1)}
        {@const frameRef = tile.seq.frameRefs[clampedIndex]}
        {@const frameView = frameRef === undefined ? undefined : view.frames[frameRef]}
        <div class="cycle-cell">
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
            <span class="cycle-cell-label">{tile.seq.facing === "none" ? `Cycle ${tile.index}` : tile.seq.facing}</span>
        </div>
    {/each}
</div>
