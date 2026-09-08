<script lang="ts">
    import type { Facing } from "@bgforge/image";
    import type { AnimationView, FrameView, SequenceView } from "../messages";
    import { createFrameFallback } from "../render/frame-loading";
    import { cycleFrameIndex } from "../render/playback";
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
        layoutScale,
        spriteScale,
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
        layoutScale: number;
        spriteScale: number;
        tileBox: TileBox;
        showOffsetMarker: boolean;
    } = $props();

    const shownFacing = $derived(facing ?? seq.facing);

    // Playback holds one shared frame index; a shorter sequence wraps at its own length (playback.ts).
    // Read off the open stance rather than taken as a prop: it is a property of what is being drawn, and
    // every layout above this passes the same view through untouched.
    const frameRef = $derived(seq.frameRefs[cycleFrameIndex(seq.frameRefs.length, frame, view.set?.reversed)]);
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
        {layoutScale}
        {spriteScale}
        sourceFormat={view.sourceFormat}
        dirOffsetX={seq.dirOffsetX}
        dirOffsetY={seq.dirOffsetY}
        {tileBox}
        {showOffsetMarker}
        ariaLabel={shownFacing === "none" ? "Animation frame" : `Animation frame facing ${shownFacing}`}
    />
{/if}
