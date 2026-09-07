<script lang="ts">
    import type { Facing } from "@bgforge/image";
    import type { AnimationView, FrameView, SequenceView } from "../messages";
    import { createFrameFallback } from "../render/frame-loading";
    import type { TileBox } from "../render/anchor";
    import FrameCanvas from "./FrameCanvas.svelte";

    // The one frame-resolution path for every layout (rose, grid): resolves the shared playback
    // frame index against this sequence and renders it. Layout-specific chrome stays in the caller.
    const {
        view,
        loadedPixels,
        seq,
        facing,
        frame,
        zoom,
        tileBox,
        showOffsetMarker,
    }: {
        view: AnimationView;
        // Pixels delivered so far, by frame index: the open carries only each cycle's first frame,
        // so a tile can be laid out (geometry always crosses) before its pixels arrive.
        loadedPixels: ReadonlyMap<number, Uint8Array>;
        seq: SequenceView;
        // The direction to announce. An untagged IE cycle carries no facing of its own - the rose
        // derives it from the block scheme - so without this every tile of a nine-direction wheel
        // announces itself identically.
        facing?: Facing;
        frame: number;
        zoom: number;
        tileBox: TileBox;
        showOffsetMarker: boolean;
    } = $props();

    const shownFacing = $derived(facing ?? seq.facing);

    // Playback holds one shared frame index; a shorter sequence clamps to its own last frame.
    const clampedIndex = $derived(Math.min(frame, seq.frameRefs.length - 1));
    const frameRef = $derived(seq.frameRefs[clampedIndex]);
    const frameView = $derived(frameRef === undefined ? undefined : view.frames[frameRef]);
    const bytes = $derived(frameRef === undefined ? undefined : loadedPixels.get(frameRef));

    // Holds the last frame that drew, so a lazily-arriving frame never blanks the tile. Scoped to
    // `view`, which is what drops the hold when a refresh replaces the document (frame-loading.ts).
    const fallback = createFrameFallback<FrameView>();
    const shown = $derived(fallback(view, frameView, bytes));
</script>

{#if shown}
    <FrameCanvas
        frame={shown.frame}
        bytes={shown.bytes}
        colorModel={view.colorModel}
        palette={view.colorModel === "indexed" ? view.palette : undefined}
        transparentIndex={view.meta.transparentIndex ?? 0}
        {zoom}
        sourceFormat={view.sourceFormat}
        dirOffsetX={seq.dirOffsetX}
        dirOffsetY={seq.dirOffsetY}
        {tileBox}
        {showOffsetMarker}
        ariaLabel={shownFacing === "none" ? "Animation frame" : `Animation frame facing ${shownFacing}`}
    />
{/if}
