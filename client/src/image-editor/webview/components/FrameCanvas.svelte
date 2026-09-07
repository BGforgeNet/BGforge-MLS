<script lang="ts">
    import type { Rgba, SourceFormat } from "@bgforge/image";
    import type { FrameView } from "../messages";
    import { frameToRgba, paletteLut, rgbaFrameToRgba } from "../render/indexed-to-rgba";
    import { frameTopLeft, referenceMarkerPercent, type TileBox } from "../render/anchor";

    // The per-tile backdrop (.frame-tile-bg, fed by the stage's --tile-bg variable) must stay UNDER
    // every sprite: anchor-shifted canvases overhang their 96px box, so backdrops and canvases carry
    // z-indexes in one shared stacking context (styles.css) rather than relying on DOM order, which
    // would paint a later tile's backdrop over an earlier tile's overhang. Transparent pixels are
    // alpha-0 in the bitmap and show the backdrop through.
    const {
        frame,
        bytes,
        colorModel,
        palette,
        transparentIndex,
        zoom,
        sourceFormat,
        dirOffsetX,
        dirOffsetY,
        tileBox,
        showOffsetMarker = false,
        ariaLabel = "Animation frame",
    }: {
        frame: FrameView;
        // This frame's delivered pixels. The caller renders nothing until they arrive, so the tile
        // never paints a half-loaded frame.
        bytes: Uint8Array;
        // Decides how those bytes are read: palette indices, or RGBA quads that need no palette.
        colorModel: "indexed" | "rgba";
        palette: Rgba[] | undefined;
        transparentIndex: number;
        zoom: number;
        sourceFormat: SourceFormat;
        dirOffsetX: number;
        dirOffsetY: number;
        tileBox: TileBox; // unzoomed tile footprint and reference point, uniform across the animation
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
            tileBox,
        ),
    );

    // The offset marker sits on the sprite's actual anchor - the tile reference point the sprite is
    // positioned by (BAM: tile centre; FRM: the feet line, which depends on the frame height).
    const markerPos = $derived(referenceMarkerPercent(sourceFormat, frame.height, tileBox));

    // Resolved per PALETTE, never per frame: the draw below runs on every playback step, and folding
    // the palette into it made the per-pixel lookup the whole cost of playing an animation.
    const lut = $derived(palette === undefined ? undefined : paletteLut(palette, transparentIndex));

    // eslint-disable-next-line prefer-const -- reassigned via bind:this in the template
    let canvasEl = $state<HTMLCanvasElement | undefined>();

    $effect(() => {
        const canvas = canvasEl;
        if (!canvas || frame.width <= 0 || frame.height <= 0) return;

        // The backing store holds the frame at NATIVE resolution and the element is scaled by CSS
        // (`image-rendering: pixelated` on .frame-tile canvas), so zoom costs the compositor a scale
        // rather than costing this effect a second canvas, a second context and a scaling drawImage on
        // every playback step. Sizing stays here beside the draw because assigning width/height resets
        // the backing store; only a real change is assigned, since playback re-enters at the frame rate
        // with the frame's own size usually unchanged.
        if (canvas.width !== frame.width) canvas.width = frame.width;
        if (canvas.height !== frame.height) canvas.height = frame.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Converted per draw rather than cached per frame: a creature stance's frames are hundreds of
        // KB of RGBA each, so holding a decoded cycle per tile costs tens of MB - and the conversion
        // now fits the frame budget many times over.
        //
        // A browser-allocated ImageData rather than the constructor: frameToRgba's Uint8ClampedArray
        // return type widens to the ArrayBufferLike variant, which the constructor's ImageDataArray
        // overload rejects, while `.set()` accepts any ArrayLike<number> regardless of buffer type.
        // No clear first - putImageData replaces every pixel of a surface that is exactly frame-sized.
        const image = ctx.createImageData(frame.width, frame.height);
        image.data.set(
            colorModel === "rgba" || lut === undefined
                ? rgbaFrameToRgba(bytes)
                : frameToRgba(bytes, frame.width, frame.height, lut),
        );
        ctx.putImageData(image, 0, 0);
    });

</script>

<div class="frame-tile" style:width="{tileBox.w * zoom}px" style:height="{tileBox.h * zoom}px">
    <div class="frame-tile-bg" aria-hidden="true"></div>
    <!-- The element carries the ZOOMED size; its backing store holds the frame at native resolution
         (see the effect above), so the two must be set together or the sprite draws at the wrong scale. -->
    <canvas
        bind:this={canvasEl}
        aria-label={ariaLabel}
        style:left="{topLeft.x * zoom}px"
        style:top="{topLeft.y * zoom}px"
        style:width="{frame.width * zoom}px"
        style:height="{frame.height * zoom}px"
    ></canvas>
    {#if showOffsetMarker}
        <div class="frame-offset-marker" style:left="{markerPos.x}%" style:top="{markerPos.y}%" aria-hidden="true"></div>
    {/if}
</div>
