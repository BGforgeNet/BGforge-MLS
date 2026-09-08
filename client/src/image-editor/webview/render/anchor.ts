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
 * The footprint is one constant square (TILE_BOX_PX); what varies is the REFERENCE, which is placed to
 * centre whatever is drawn. Art is routinely far to one side of its anchor - an IE creature's ground point
 * can sit hundreds of pixels below the sprite - so the reference is carried explicitly rather than assumed
 * to be the middle, and it may land outside the box entirely.
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

/**
 * How much of the tile is kept BELOW the anchor - room for the shadow and overhang an IE creature carries
 * under its ground point, and for the ground to read as ground rather than as the edge of a box.
 */
const FEET_HEIGHT_FRACTION = 0.25;

/**
 * The tile every frame is drawn in: one square, with the sprite's ground point at a fixed spot in it.
 *
 * A constant, not a measurement. Sizing or centring the tile per animation meant it moved whenever the
 * reader changed action or sequence, and every rule that placed the art by measuring it had a scale at
 * which it stopped holding. A fixed anchor cannot: the feet are a quarter of the way up every tile of
 * every animation, so the only thing a switch changes is the picture standing on them.
 */
export const TILE_BOX: TileBox = {
    w: TILE_BOX_PX,
    h: TILE_BOX_PX,
    refX: TILE_BOX_PX / 2,
    refY: TILE_BOX_PX * (1 - FEET_HEIGHT_FRACTION),
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
 * How many times the fitted size the drawn art can be shown at before it leaves its tile - what the Auto
 * control asks for, and what a freshly opened animation is drawn at.
 *
 * The anchor is fixed in the tile and the art hangs off it, so each frame gets one bound per edge: the
 * room on that side against how far the art reaches that way. A ground-anchored sprite is therefore
 * bounded by the room above the feet, and one with shadow below it by the quarter tile beneath.
 *
 * The tightest bound over the WHOLE FILE, not over the cycles on screen. A rose of one creature has to
 * keep every facing whole, and the scale is chosen once when the animation opens and then left alone - so
 * a sequence that reaches further than the one being looked at has to fit at it too, or picking it later
 * would push the sprite over its neighbours.
 */
export function spriteFillRatio(
    view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">,
    box: TileBox,
): number {
    const drawn = view.sequences;
    let ratio = Infinity;
    /** A `room / reach` bound, ignored where the art does not extend that way - nothing to run out of. */
    const bound = (room: number, reach: number): void => {
        if (reach > 0) ratio = Math.min(ratio, room / reach);
    };
    for (const seq of drawn) {
        for (const ref of seq.frameRefs) {
            const frame = view.frames[ref];
            if (!frame) continue;
            const point = referencePoint(view.sourceFormat, frame.height, box);
            const { ax, ay } = offsetToAnchor(view.sourceFormat, {
                width: frame.width,
                height: frame.height,
                offsetX: frame.offsetX,
                offsetY: frame.offsetY,
                dirOffsetX: seq.dirOffsetX,
                dirOffsetY: seq.dirOffsetY,
            });
            bound(point.x, ax);
            bound(box.w - point.x, frame.width - ax);
            bound(point.y, ay);
            bound(box.h - point.y, frame.height - ay);
        }
    }
    // Nothing drawable: the fitted size is the only size there is anything to say about.
    return Number.isFinite(ratio) ? ratio : 1;
}

/**
 * The reference point as a percentage of the tile, for positioning the offset marker so it sits on the
 * frame's anchor (BAM: the stored centre; FRM: the feet line). Derived from referencePoint, never a fixed 50%.
 */
export function referenceMarkerPercent(format: SourceFormat, height: number, box: TileBox): { x: number; y: number } {
    const ref = referencePoint(format, height, box);
    return { x: (ref.x / box.w) * 100, y: (ref.y / box.h) * 100 };
}
