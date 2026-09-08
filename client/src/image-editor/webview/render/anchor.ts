import type { SourceFormat } from "@bgforge/image";
// Import the pure anchor helper from its dedicated subpath, NOT the "@bgforge/image" barrel: the barrel
// re-exports the png/bamc codecs (Node Buffer/zlib) which crash a browser webview bundle on load.
import { offsetToAnchor } from "@bgforge/image/frame-anchor";
import type { AnimationView } from "../messages";
import { TILE_BASE_PX } from "./tile";

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
 * A rectangle with an explicit reference rather than a square centred on one: art is routinely far to one
 * side of its anchor - an IE creature's ground point can sit hundreds of pixels below the sprite - and a
 * square big enough to reach it in every direction is several times the area the frames occupy. Every
 * layout is sized from this, so that surplus is paid again per tile across a whole rose or grid.
 *
 * What has to hold is only that the reference lands at the SAME spot in every tile of an animation, which
 * an explicit `refX`/`refY` gives directly; the square shape was never what aligned them.
 */
export interface TileBox {
    w: number;
    h: number;
    refX: number;
    refY: number;
}

/** The floor tile, for a surface with nothing loaded to measure. */
export const DEFAULT_TILE_BOX: TileBox = {
    w: TILE_BASE_PX,
    h: TILE_BASE_PX,
    refX: TILE_BASE_PX / 2,
    refY: TILE_BASE_PX / 2,
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
): number {
    let ratio = Infinity;
    /** A `room / need` bound, ignored where the art does not extend that way (nothing to run out of). */
    const bound = (room: number, need: number): void => {
        if (need > 0) ratio = Math.min(ratio, room / need);
    };
    for (const seq of view.sequences) {
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
 * The smallest tile (unzoomed px, each side floored at TILE_BASE_PX) that contains every frame of every
 * sequence at its anchored position - the tile STRETCHES for oversized sprites rather than clipping them
 * or zooming out, and the union across the whole animation is what stops a sprite shifting between frames.
 *
 * Both reference formulas are `ref + <box-independent term>`, so a frame's position relative to the
 * reference does not depend on the box: measuring against a zero box is exact, and the result cannot feed
 * back into itself.
 *
 * The ART alone sets the extents. The reference is a coordinate that may fall OUTSIDE the box: a sprite's
 * ground point can sit well clear of its art, and spanning to it made a tile hundreds of px tall to hold a
 * few dozen of drawing - dead space every layout then pays per tile, and the rose pays it as radius. The
 * offset marker still draws there, since a tile does not clip (animation-tiles.css); it is diagnostic, and
 * outside the box is where that animation genuinely puts it.
 */
export function tileBoxPx(view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">): TileBox {
    const { minX, minY, spanX, spanY } = artExtents(view);
    // Nothing referenced anything drawable, so there are no extents to size from.
    if (spanX === undefined || spanY === undefined) return DEFAULT_TILE_BOX;
    // Padding a side up to the floor is split evenly, so a small sprite stays where a bigger one would be
    // rather than jumping to a corner of its minimum tile.
    const pad = (span: number): number => Math.max(0, TILE_BASE_PX - span) / 2;
    return {
        w: Math.max(TILE_BASE_PX, spanX),
        h: Math.max(TILE_BASE_PX, spanY),
        refX: -minX + pad(spanX),
        refY: -minY + pad(spanY),
    };
}

/**
 * How much the animation actually DRAWS, unzoomed and unfloored - the union of every referenced frame at
 * its anchored position.
 *
 * The tile box floors each side at TILE_BASE_PX so a small sprite keeps a workable cell, which makes the
 * box a bad measure of the art: the stage sizes a sprite against the room its cell really has, and a 16px
 * rat in a 96px box would otherwise be read as already filling it.
 */
export function artSpanPx(view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">): {
    w: number;
    h: number;
} {
    const { spanX, spanY } = artExtents(view);
    return { w: spanX ?? TILE_BASE_PX, h: spanY ?? TILE_BASE_PX };
}

/** Shared by both so the box and the art it holds can never be measured from different traversals. */
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
