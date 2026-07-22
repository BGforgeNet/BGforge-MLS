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

    // Recomputed from `view` (not passed a pre-computed layout): compass-layout.ts is a cheap pure
    // function, and CompassRose only ever mounts when the caller has already decided mode === "compass".
    const tiles = $derived.by(() => {
        const layout = layoutSequences(view);
        return layout.mode === "compass" ? layout.tiles : [];
    });
</script>

<div class="compass-rose">
    {#each tiles as tile (tile.seq.facing)}
        {@const clampedIndex = Math.min(frame, tile.seq.frameRefs.length - 1)}
        {@const frameRef = tile.seq.frameRefs[clampedIndex]}
        {@const frameView = frameRef === undefined ? undefined : view.frames[frameRef]}
        <div class="compass-cell" style:grid-row={tile.cell.row + 1} style:grid-column={tile.cell.col + 1}>
            {#if frameView}
                <FrameCanvas
                    frame={frameView}
                    palette={view.palette}
                    transparentIndex={view.meta.transparentIndex ?? 0}
                    {zoom}
                    {background}
                    {showOffsetMarker}
                />
            {/if}
        </div>
    {/each}
</div>
