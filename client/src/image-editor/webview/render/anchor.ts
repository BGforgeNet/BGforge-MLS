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

/** Extents are measured against a zero box, so the numbers come out relative to the reference point. */
const PROBE_BOX: TileBox = { w: 0, h: 0, refX: 0, refY: 0 };

/**
 * The smallest tile (unzoomed px, each side floored at TILE_BASE_PX) that contains every frame of every
 * sequence at its anchored position, plus the reference point itself - the tile STRETCHES for oversized
 * sprites rather than clipping them or zooming out.
 *
 * Both reference formulas are `ref + <box-independent term>`, so a frame's position relative to the
 * reference does not depend on the box: measuring against a zero box is exact, and the result cannot feed
 * back into itself.
 *
 * The reference is included in the extents so it always lands inside the tile - the offset marker is drawn
 * on it, and every layout positions a tile by it.
 */
export function tileBoxPx(view: Pick<AnimationView, "sourceFormat" | "frames" | "sequences">): TileBox {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
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
    // Padding a side up to the floor is split evenly, so a small sprite stays where a bigger one would be
    // rather than jumping to a corner of its minimum tile.
    const pad = (span: number): number => Math.max(0, TILE_BASE_PX - span) / 2;
    const spanX = Math.ceil(maxX - minX);
    const spanY = Math.ceil(maxY - minY);
    return {
        w: Math.max(TILE_BASE_PX, spanX),
        h: Math.max(TILE_BASE_PX, spanY),
        refX: -minX + pad(spanX),
        refY: -minY + pad(spanY),
    };
}

/**
 * The reference point as a percentage of the tile, for positioning the offset marker so it sits on the
 * frame's anchor (BAM: the stored centre; FRM: the feet line). Derived from referencePoint, never a fixed 50%.
 */
export function referenceMarkerPercent(format: SourceFormat, height: number, box: TileBox): { x: number; y: number } {
    const ref = referencePoint(format, height, box);
    return { x: (ref.x / box.w) * 100, y: (ref.y / box.h) * 100 };
}
