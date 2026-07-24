<script lang="ts">
    import type { Rgba, SourceFormat } from "@bgforge/image";
    import { decodeFramePixels, type FrameView } from "../messages";
    import { frameToRgba } from "../render/indexed-to-rgba";
    import { frameTopLeft, referenceMarkerPercent } from "../render/anchor";

    // The per-tile backdrop (.frame-tile-bg, fed by the stage's --tile-bg variable) must stay UNDER
    // every sprite: anchor-shifted canvases overhang their 96px box, so backdrops and canvases carry
    // z-indexes in one shared stacking context (styles.css) rather than relying on DOM order, which
    // would paint a later tile's backdrop over an earlier tile's overhang. Transparent pixels are
    // alpha-0 in the bitmap and show the backdrop through.
    const {
        frame,
        palette,
        transparentIndex,
        zoom,
        sourceFormat,
        dirOffsetX,
        dirOffsetY,
        tileBase,
        showOffsetMarker = false,
        ariaLabel = "Animation frame",
    }: {
        frame: FrameView;
        palette: Rgba[];
        transparentIndex: number;
        zoom: number;
        sourceFormat: SourceFormat;
        dirOffsetX: number;
        dirOffsetY: number;
        tileBase: number; // unzoomed tile footprint (tileSizePx of the whole view, uniform per animation)
        showOffsetMarker?: boolean;
        ariaLabel?: string;
    } = $props();

    // Game-accurate top-left within the tile (feet-anchored for FRM, center-pixel for BAM); zoom scales
    // both the footprint and the anchor. See render/anchor.ts.
    const topLeft = $derived(
        frameTopLeft(
            {
                sourceFormat,
                width: frame.width,
                height: frame.height,
                offsetX: frame.offsetX,
                offsetY: frame.offsetY,
                dirOffsetX,
                dirOffsetY,
            },
            tileBase,
        ),
    );

    // The offset marker sits on the sprite's actual anchor - the tile reference point the sprite is
    // positioned by (BAM: tile centre; FRM: the feet line, which depends on the frame height).
    const markerPos = $derived(referenceMarkerPercent(sourceFormat, frame.height, tileBase));

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
        const pixels = decodeFramePixels(frame.pixels);
        imageData.data.set(frameToRgba(pixels, frame.width, frame.height, palette, transparentIndex));
        nctx.putImageData(imageData, 0, 0);

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(native, 0, 0, canvas.width, canvas.height);
    });

</script>

<div class="frame-tile" style:width="{tileBase * zoom}px" style:height="{tileBase * zoom}px">
    <div class="frame-tile-bg" aria-hidden="true"></div>
    <canvas
        bind:this={canvasEl}
        aria-label={ariaLabel}
        style:left="{topLeft.x * zoom}px"
        style:top="{topLeft.y * zoom}px"
    ></canvas>
    {#if showOffsetMarker}
        <div class="frame-offset-marker" style:left="{markerPos.x}%" style:top="{markerPos.y}%" aria-hidden="true"></div>
    {/if}
</div>
