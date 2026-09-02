<script lang="ts">
    import type { AnimationView, FrameView, SequenceView } from "../messages";
    import { createFrameFallback } from "../render/frame-loading";
    import FrameCanvas from "./FrameCanvas.svelte";

    // The one frame-resolution path for every layout (rose, grid): resolves the shared playback
    // frame index against this sequence and renders it. Layout-specific chrome stays in the caller.
    const {
        view,
        loadedPixels,
        seq,
        frame,
        zoom,
        tileBase,
        showOffsetMarker,
    }: {
        view: AnimationView;
        // Pixels delivered so far, by frame index: the open carries only each cycle's first frame,
        // so a tile can be laid out (geometry always crosses) before its pixels arrive.
        loadedPixels: ReadonlyMap<number, Uint8Array>;
        seq: SequenceView;
        frame: number;
        zoom: number;
        tileBase: number;
        showOffsetMarker: boolean;
    } = $props();

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
        {tileBase}
        {showOffsetMarker}
        ariaLabel={seq.facing === "none" ? "Animation frame" : `Animation frame facing ${seq.facing}`}
    />
{/if}
