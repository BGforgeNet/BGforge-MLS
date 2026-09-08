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

/** The empty tile, for a surface with nothing loaded to centre in it. */
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
 * How many times the fitted size a sprite can be drawn at before it leaves its cell - what "fill" means.
 *
 * NOT the art-to-cell ratio. The anchor is the pivot both scales turn on (`spriteRect`), and it is rarely
 * the middle of anything: a frame drawn at `reference*layout - anchor*sprite` walks across its cell as the
 * sprite grows, so a sprite anchored far below its own art runs out of room at the TOP long before its art
 * is as wide as the cell. Each frame contributes one bound per edge, all of them linear in the sprite
 * scale, and the tightest is the answer for the whole animation - no frame may clip, since a rose of one
 * creature has to keep every facing whole.
 *
 * Expressed relative to the layout scale, which every bound is proportional to: the cell and the reference
 * both grow with it, so the ratio is a property of the animation and its box alone.
 */
export function spriteFillRatio(
    view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">,
    box: TileBox,
    drawn: readonly SequenceExtent[] = view.sequences,
): number {
    let ratio = Infinity;
    /** A `room / need` bound, ignored where the art does not extend that way (nothing to run out of). */
    const bound = (room: number, need: number): void => {
        if (need > 0) ratio = Math.min(ratio, room / need);
    };
    for (const seq of drawn) {
        for (const ref of seq.frameRefs) {
            const frame = view.frames[ref];
            if (!frame) continue;
            const a = {
                sourceFormat: view.sourceFormat,
                width: frame.width,
                height: frame.height,
                offsetX: frame.offsetX,
                offsetY: frame.offsetY,
                dirOffsetX: seq.dirOffsetX,
                dirOffsetY: seq.dirOffsetY,
            };
            const point = referencePoint(view.sourceFormat, frame.height, box);
            const { ax, ay } = offsetToAnchor(view.sourceFormat, a);
            bound(point.x, ax);
            bound(box.w - point.x, frame.width - ax);
            bound(point.y, ay);
            bound(box.h - point.y, frame.height - ay);
        }
    }
    // Nothing drawable, or an animation whose every frame hangs off its anchor in one direction only: the
    // fitted size is the only size there is anything to say about.
    return Number.isFinite(ratio) ? ratio : 1;
}

/** Extents are measured against a zero box, so the numbers come out relative to the reference point. */
const PROBE_BOX: TileBox = { w: 0, h: 0, refX: 0, refY: 0 };

/**
 * The tile the DRAWN cycles are centred in: always TILE_BOX_PX square, with the reference placed so their
 * art lands in the middle of it.
 *
 * Two separate decisions. The SIZE is constant (see TILE_BOX_PX) so the background a reader is looking at
 * never resizes under them. The REFERENCE is per drawn cycle: a file's stances differ in height, and one
 * reference for the whole file drew the tall ones flush against the top while the room the short ones
 * needed sat empty at the feet. Centring is computed from the cycles PASSED, so it moves when the reader
 * picks another sequence and holds still while one plays - every frame of a cycle shares one reading.
 *
 * Both reference formulas are `ref + <box-independent term>`, so a frame's position relative to the
 * reference does not depend on the box: measuring against a zero box is exact, and the result cannot feed
 * back into itself.
 *
 * The ART alone is centred. The reference is a coordinate that may fall OUTSIDE the box: a sprite's ground
 * point can sit well clear of its art, and centring on it would push the drawing off the tile entirely.
 * The offset marker still draws there, since a tile does not clip (animation-tiles.css); it is diagnostic,
 * and outside the box is where that animation genuinely puts it.
 */
export function tileBoxPx(
    view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">,
    drawn: readonly SequenceExtent[] = view.sequences,
): TileBox {
    const { minX, minY, spanX, spanY } = artExtents(view, drawn);
    // Nothing referenced anything drawable, so there is no art to centre.
    if (spanX === undefined || spanY === undefined) return DEFAULT_TILE_BOX;
    return {
        w: TILE_BOX_PX,
        h: TILE_BOX_PX,
        refX: -minX + (TILE_BOX_PX - spanX) / 2,
        refY: -minY + (TILE_BOX_PX - spanY) / 2,
    };
}

/** What a cycle has to say about where its art sits: which frames, and the band offset they carry. */
type SequenceExtent = Pick<AnimationView["sequences"][number], "frameRefs" | "dirOffsetX" | "dirOffsetY">;

function artExtents(
    view: Pick<AnimationView, "sourceFormat" | "frames">,
    sequences: readonly SequenceExtent[],
): {
    minX: number;
    minY: number;
    spanX: number | undefined;
    spanY: number | undefined;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const seq of sequences) {
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
