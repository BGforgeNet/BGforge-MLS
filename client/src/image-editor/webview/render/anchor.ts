import type { SourceFormat } from "@bgforge/image";
// Import the pure anchor helper from its dedicated subpath, NOT the "@bgforge/image" barrel: the barrel
// re-exports the png/bamc codecs (Node Buffer/zlib) which crash a browser webview bundle on load.
import { offsetToAnchor } from "@bgforge/image/frame-anchor";
import type { AnimationView } from "../messages";
import { TILE_BOX_PX } from "./tile";

/**
 * Where a frame's top-left corner sits (unzoomed px) within its tile: topLeft = referencePoint - anchor,
 * where the anchor (which frame pixel lands on the reference) is computed per-format by `offsetToAnchor`
 * in @bgforge/image.
 *
 * The reference point (where the anchor lands in the tile) is the tile's own `refX`/`refY`, plus a
 * per-format term so that a sprite keeps its on-tile spot when it is converted:
 * - BAM/BAMC: the reference itself. The stored centre pixel is the anchor, so the sprite hangs on the
 *   reference by its own centre.
 * - FRM: a "feet line", the reference pushed down by half the frame (`ref + height/2 - 1`). An FRM anchors
 *   by its bottom-centre (feet); putting the feet there centres the frame on the reference, matching where
 *   a centre-anchored BAM of the same content sat - so a BAM->FRM conversion does not move the art, only
 *   relocates the anchor from the centre down to the feet.
 */

/**
 * A tile's footprint (unzoomed px) and where the anchor reference point sits INSIDE it.
 *
 * The footprint is a square: TILE_BOX_PX, or the art's own size where the reader has scaled it past that
 * (`tileBoxPx`). What varies independently is the REFERENCE, which is placed to centre whatever is drawn.
 * Art is routinely far to one side of its anchor - an IE creature's ground point can sit hundreds of
 * pixels below the sprite - so the reference is carried explicitly rather than assumed to be the middle,
 * and it may land outside the box entirely.
 *
 * What has to hold is only that the reference lands at the SAME spot in every tile drawing the same
 * cycles, which an explicit `refX`/`refY` gives directly.
 */
export interface TileBox {
    w: number;
    h: number;
    refX: number;
    refY: number;
}

/** The empty tile, for a surface with nothing loaded to place in it. */
export const DEFAULT_TILE_BOX: TileBox = {
    w: TILE_BOX_PX,
    h: TILE_BOX_PX,
    refX: TILE_BOX_PX / 2,
    refY: TILE_BOX_PX / 2,
};

// The reference point for a frame of the given height. Exhaustive by SourceFormat: a new format must
// DECLARE its reference here (compile error in the default arm otherwise).
function referencePoint(format: SourceFormat, height: number, box: TileBox): { x: number; y: number } {
    switch (format) {
        case "frm":
            // Feet line = the reference pushed down by half the frame, so the bottom-anchored frame ends
            // up vertically centred on it (matching a centre-anchored BAM's position).
            return { x: box.refX, y: box.refY + height / 2 - 1 };
        case "bam":
        case "bamc":
        case "bamv2":
            // v2 anchors on the same per-frame centre coordinate as v1, so it is centred identically.
            return { x: box.refX, y: box.refY };
        default: {
            const unhandled: never = format;
            throw new Error(`referencePoint: unhandled sourceFormat ${String(unhandled)}`);
        }
    }
}

export interface AnchorInput {
    sourceFormat: SourceFormat;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    dirOffsetX: number;
    dirOffsetY: number;
}

export function frameTopLeft(a: AnchorInput, box: TileBox): { x: number; y: number } {
    const ref = referencePoint(a.sourceFormat, a.height, box);
    const { ax, ay } = offsetToAnchor(a.sourceFormat, a);
    return { x: ref.x - ax, y: ref.y - ay };
}

/**
 * Where a frame is drawn, in px, under the stage's TWO independent scales.
 *
 * The cell grid is fitted to the stage automatically (`layoutScale`) while the reader scales the art
 * inside it (`spriteScale`), so a small creature can be read without the wheel growing off-screen. The
 * anchor is the pivot of both: it sits at the cell's own reference, and the art expands around it - so
 * raising the sprite scale grows a sprite in place instead of walking it across its cell.
 *
 * With one scale passed for both this is exactly `frameTopLeft` scaled, which is what the stage does
 * while the reader leaves the sprite scale at the fitted size.
 */
export function spriteRect(
    a: AnchorInput,
    box: TileBox,
    layoutScale: number,
    spriteScale: number,
): { left: number; top: number; width: number; height: number } {
    const ref = referencePoint(a.sourceFormat, a.height, box);
    const { ax, ay } = offsetToAnchor(a.sourceFormat, a);
    return {
        left: ref.x * layoutScale - ax * spriteScale,
        top: ref.y * layoutScale - ay * spriteScale,
        width: a.width * spriteScale,
        height: a.height * spriteScale,
    };
}

/**
 * The scale at which the animation exactly fills the BASE tile - what Auto asks for, and what a freshly
 * opened animation is drawn at. Past it the tile grows with the art rather than the art clipping.
 *
 * Against TILE_BOX_PX, never the tile actually on screen: that one takes the art's own size once the
 * reader scales past the base square, so measuring against it would make Fill mean whatever scale is
 * already showing.
 *
 * The art's own union and nothing else: the anchor lands wherever centring that union puts it
 * (`tileBoxPx`), so where it sits inside the art costs the sprite nothing. The longer side of the union
 * decides, since both have to fit; the other keeps its margin, split evenly.
 *
 * Measured over the WHOLE FILE, not the cycles on screen. The scale is chosen once when the animation
 * opens and then left alone, so a sequence that reaches further than the one being looked at has to fit at
 * it too - otherwise picking it later would grow every tile under the reader.
 */
export function spriteFillRatio(view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">): number {
    const { spanX, spanY } = artExtents(view);
    // Nothing drawable: the fitted size is the only size there is anything to say about.
    if (spanX === undefined || spanY === undefined || spanX <= 0 || spanY <= 0) return 1;
    return Math.min(TILE_BOX_PX / spanX, TILE_BOX_PX / spanY);
}

/** Extents are measured against a zero box, so the numbers come out relative to the reference point. */
const PROBE_BOX: TileBox = { w: 0, h: 0, refX: 0, refY: 0 };

/**
 * The tile an animation is drawn in: a square holding the whole file's art at the size it is being drawn,
 * with the reference placed so that art lands in the middle of it.
 *
 * Two decisions, both per ANIMATION and neither per sequence. The SIZE is TILE_BOX_PX while the art fits
 * it, so the background never resizes under a reader switching stance, and the art's own square past that,
 * so a sprite scaled beyond the fitted size spreads the tiles apart instead of reaching over its
 * neighbours. Both layouts space their cells by the tile, which makes a tile that holds its own art the
 * whole of the no-overlap guarantee. The REFERENCE centres the whole file's art - every cycle, not the one
 * on screen - so switching sequence or action moves nothing at all: the tile stays, the anchor stays, and
 * only the picture standing on it changes.
 *
 * The art is drawn at `reference*layout - anchor*sprite`, so it scales about its ANCHOR: a reference that
 * centred it at 1:1 would stop centring it at any other zoom, and a creature anchored low would drift up
 * and leave a band of dead tile under its feet. Carrying the ratio of the two scales holds the middle of
 * the art on the middle of the tile at whatever size it is shown; at 1:1 the term is 1.
 *
 * The reference is a coordinate, and may land outside the box: a sprite's ground point can sit well clear
 * of its art. The offset marker still draws there, since a tile does not clip (animation-tiles.css); it is
 * diagnostic, and outside the tile is where that animation genuinely puts it.
 */
export function tileBoxPx(
    view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">,
    spriteScaleRatio = 1,
): TileBox {
    const { minX, minY, spanX, spanY } = artExtents(view);
    if (spanX === undefined || spanY === undefined) return DEFAULT_TILE_BOX;
    // One side for both axes: the rose spaces its facings on a CIRCLE, by the tile's longer side, so a
    // box hugging each axis would buy nothing there and give the two layouts differently shaped backdrops.
    const side = Math.max(TILE_BOX_PX, Math.ceil(Math.max(spanX, spanY) * spriteScaleRatio));
    const centre = (min: number, span: number): number => side / 2 - (min + span / 2) * spriteScaleRatio;
    return { w: side, h: side, refX: centre(minX, spanX), refY: centre(minY, spanY) };
}

/** The union of every frame the animation references, at its anchored position, relative to the anchor. */
function artExtents(view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">): {
    minX: number;
    minY: number;
    spanX: number | undefined;
    spanY: number | undefined;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const seq of view.sequences) {
        for (const ref of seq.frameRefs) {
            const frame = view.frames[ref];
            if (!frame) continue;
            const rel = frameTopLeft(
                {
                    sourceFormat: view.sourceFormat,
                    width: frame.width,
                    height: frame.height,
                    offsetX: frame.offsetX,
                    offsetY: frame.offsetY,
                    dirOffsetX: seq.dirOffsetX,
                    dirOffsetY: seq.dirOffsetY,
                },
                PROBE_BOX,
            );
            minX = Math.min(minX, rel.x);
            maxX = Math.max(maxX, rel.x + frame.width);
            minY = Math.min(minY, rel.y);
            maxY = Math.max(maxY, rel.y + frame.height);
        }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return { minX: 0, minY: 0, spanX: undefined, spanY: undefined };
    }
    return { minX, minY, spanX: Math.ceil(maxX - minX), spanY: Math.ceil(maxY - minY) };
}

/**
 * The reference point as a percentage of the tile, for positioning the offset marker so it sits on the
 * frame's anchor (BAM: the stored centre; FRM: the feet line). Derived from referencePoint, never a fixed 50%.
 */
export function referenceMarkerPercent(format: SourceFormat, height: number, box: TileBox): { x: number; y: number } {
    const ref = referencePoint(format, height, box);
    return { x: (ref.x / box.w) * 100, y: (ref.y / box.h) * 100 };
}
