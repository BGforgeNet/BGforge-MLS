<script lang="ts">
    import type { Rgba } from "@bgforge/image";
    import type { FrameView } from "../messages";
    import { checkerboardCss, frameToRgba, GREEN, type Background } from "../render/indexed-to-rgba";

    // Every tile centers its frame within this fixed, unzoomed footprint so frames of differing
    // width/height within the same sequence all anchor at the same on-screen point (see the
    // offsetX/offsetY positioning below) instead of jittering as the shared frame index advances.
    const TILE_BASE_PX = 96;

    const {
        frame,
        palette,
        transparentIndex,
        zoom,
        background,
        showOffsetMarker = false,
    }: {
        frame: FrameView;
        palette: Rgba[];
        transparentIndex: number;
        zoom: number;
        background: Background;
        showOffsetMarker?: boolean;
    } = $props();

    // eslint-disable-next-line prefer-const -- reassigned via bind:this in the template
    let canvasEl = $state<HTMLCanvasElement | undefined>();

    $effect(() => {
        const canvas = canvasEl;
        if (!canvas || frame.width <= 0 || frame.height <= 0) return;

        // Sizing and drawing happen atomically in this same effect: assigning canvas.width/height
        // resets the backing store (clears pixels, resets imageSmoothingEnabled), so if sizing lived
        // in the template instead, a zoom-only change would resize+clear the canvas without this
        // effect re-running (zoom wasn't a tracked read) and leave it blank until frame next changes.
        canvas.width = frame.width * zoom;
        canvas.height = frame.height * zoom;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw at native resolution first, then scale via drawImage with smoothing disabled - keeps
        // indexed-sprite pixels crisp (no blur) at any zoom level instead of blurring a putImageData
        // stretched directly onto a pre-scaled canvas.
        const native = document.createElement("canvas");
        native.width = frame.width;
        native.height = frame.height;
        const nctx = native.getContext("2d");
        if (!nctx) return;
        // Copy into a browser-allocated ImageData buffer via .set() rather than the ImageData
        // constructor: frameToRgba's Uint8ClampedArray return type widens to the ArrayBufferLike
        // variant, which the constructor's ImageDataArray overload rejects, but .set() accepts any
        // ArrayLike<number> regardless of buffer type.
        const imageData = nctx.createImageData(frame.width, frame.height);
        imageData.data.set(frameToRgba(frame, palette, transparentIndex));
        nctx.putImageData(imageData, 0, 0);

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(native, 0, 0, canvas.width, canvas.height);
    });

    const tileBackground = $derived(
        background === "checkered" ? checkerboardCss() : background === "green" ? GREEN : "transparent",
    );
</script>

<div
    class="frame-tile"
    style:width="{TILE_BASE_PX * zoom}px"
    style:height="{TILE_BASE_PX * zoom}px"
    style:background={tileBackground}
>
    <canvas
        bind:this={canvasEl}
        style:left="calc(50% - {frame.offsetX * zoom}px)"
        style:top="calc(50% - {frame.offsetY * zoom}px)"
    ></canvas>
    {#if showOffsetMarker}
        <div class="frame-offset-marker" aria-hidden="true"></div>
    {/if}
</div>
