import type { SourceFormat } from "@bgforge/image";
// Import the pure anchor helper from its dedicated subpath, NOT the "@bgforge/image" barrel: the barrel
// re-exports the png/bamc codecs (Node Buffer/zlib) which crash a browser webview bundle on load.
import { offsetToAnchor } from "@bgforge/image/frame-anchor";
import { TILE_BASE_PX } from "./tile";

/**
 * Where a frame's top-left corner sits (unzoomed px) within its TILE_BASE_PX tile: topLeft =
 * referencePoint - anchor, where the anchor (which frame pixel lands on the reference) is computed
 * per-format by `offsetToAnchor` in @bgforge/image.
 *
 * The reference point (where the anchor lands in the tile) is per-format so that a sprite keeps its
 * on-tile spot when it is converted:
 * - BAM/BAMC: the tile CENTRE. The stored centre pixel is the anchor, so the sprite is centred on the
 *   tile by its anchor.
 * - FRM: a "feet line" placed so the frame is VERTICALLY CENTRED (`TILE/2 + height/2 - 1`). An FRM anchors
 *   by its bottom-centre (feet); putting the feet there centres the frame, matching where a centre-anchored
 *   BAM of the same content sat - so a BAM->FRM conversion does not move the art, only relocates the anchor
 *   from the centre down to the feet.
 */
const REFERENCE_X = TILE_BASE_PX / 2;

// The reference point for a frame of the given height. Exhaustive by SourceFormat: a new format must
// DECLARE its reference here (compile error in the default arm otherwise).
function referencePoint(format: SourceFormat, height: number): { x: number; y: number } {
    switch (format) {
        case "frm":
            // Feet line = the tile-centre pushed down by half the frame, so the bottom-anchored frame ends
            // up vertically centred (matching a centre-anchored BAM's position).
            return { x: REFERENCE_X, y: TILE_BASE_PX / 2 + height / 2 - 1 };
        case "bam":
        case "bamc":
            return { x: REFERENCE_X, y: TILE_BASE_PX / 2 };
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

export function frameTopLeft(a: AnchorInput): { x: number; y: number } {
    const ref = referencePoint(a.sourceFormat, a.height);
    const { ax, ay } = offsetToAnchor(a.sourceFormat, a);
    return { x: ref.x - ax, y: ref.y - ay };
}

/**
 * The reference point as a percentage of the tile, for positioning the offset marker so it sits on the
 * frame's anchor (BAM: the tile centre; FRM: the feet line). Derived from referencePoint, never a fixed 50%.
 */
export function referenceMarkerPercent(format: SourceFormat, height: number): { x: number; y: number } {
    const ref = referencePoint(format, height);
    return { x: (ref.x / TILE_BASE_PX) * 100, y: (ref.y / TILE_BASE_PX) * 100 };
}
