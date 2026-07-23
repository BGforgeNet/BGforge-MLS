<script lang="ts">
    import type { AnimationView, SequenceView } from "../messages";
    import FrameCanvas from "./FrameCanvas.svelte";

    // The one frame-resolution path for every layout (rose, grid): resolves the shared playback
    // frame index against this sequence and renders it. Layout-specific chrome stays in the caller.
    const {
        view,
        seq,
        frame,
        zoom,
        showOffsetMarker,
    }: {
        view: AnimationView;
        seq: SequenceView;
        frame: number;
        zoom: number;
        showOffsetMarker: boolean;
    } = $props();

    // Playback holds one shared frame index; a shorter sequence clamps to its own last frame.
    const clampedIndex = $derived(Math.min(frame, seq.frameRefs.length - 1));
    const frameView = $derived.by(() => {
        const ref = seq.frameRefs[clampedIndex];
        return ref === undefined ? undefined : view.frames[ref];
    });
</script>

{#if frameView}
    <FrameCanvas
        frame={frameView}
        palette={view.palette}
        transparentIndex={view.meta.transparentIndex ?? 0}
        {zoom}
        sourceFormat={view.sourceFormat}
        dirOffsetX={seq.dirOffsetX}
        dirOffsetY={seq.dirOffsetY}
        {showOffsetMarker}
    />
{/if}
