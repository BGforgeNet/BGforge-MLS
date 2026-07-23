import type { SourceFormat } from "@bgforge/image";
// Import the pure anchor helper from its dedicated subpath, NOT the "@bgforge/image" barrel: the barrel
// re-exports the png/bamc codecs (Node Buffer/zlib) which crash a browser webview bundle on load.
import { offsetToAnchor } from "@bgforge/image/frame-anchor";
import { TILE_BASE_PX } from "./tile";

/**
 * Where a frame's top-left corner sits (unzoomed px) within its TILE_BASE_PX tile, so it renders as the
 * game positions it. topLeft = referencePoint - anchor, where the anchor (which frame pixel lands on the
 * reference) is the format-neutral quantity computed by `offsetToAnchor` in @bgforge/image - the SAME
 * function the cross-format converters use, so a preview and a Save-As can never disagree on where a
 * sprite sits. This file owns only the render-domain half: where the reference point sits inside a tile.
 *
 * FRM: the reference sits low in the tile (FRM_FEET_FRACTION) so a feet-anchored (bottom-edge) sprite
 * stays framed. BAM: the reference is the tile centre, and the frame's stored centre pixel lands on it.
 */
const FRM_FEET_FRACTION = 0.92;

export interface AnchorInput {
    sourceFormat: SourceFormat;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    dirOffsetX: number;
    dirOffsetY: number;
}

// The tile pixel a frame's anchor lands on. Exhaustive by SourceFormat: a new format must DECLARE its
// reference point here (compile error in the default arm otherwise) - the render-domain twin of
// offsetToAnchor's format-domain switch. BOTH the sprite position (frameTopLeft) AND the offset marker
// (referenceMarkerPercent) derive from this ONE function, so they cannot disagree and a new format is
// correct in both the moment it declares its reference here.
function referencePoint(format: SourceFormat): { x: number; y: number } {
    switch (format) {
        case "frm":
            return { x: TILE_BASE_PX / 2, y: TILE_BASE_PX * FRM_FEET_FRACTION };
        case "bam":
        case "bamc":
            return { x: TILE_BASE_PX / 2, y: TILE_BASE_PX / 2 };
        default: {
            const unhandled: never = format;
            throw new Error(`referencePoint: unhandled sourceFormat ${String(unhandled)}`);
        }
    }
}

export function frameTopLeft(a: AnchorInput): { x: number; y: number } {
    const ref = referencePoint(a.sourceFormat);
    const { ax, ay } = offsetToAnchor(a.sourceFormat, a);
    return { x: ref.x - ax, y: ref.y - ay };
}

/**
 * The reference point as a percentage of the tile, for positioning the offset marker so it sits exactly
 * where the sprite's anchor lands (FRM: the feet line; BAM: the tile centre). Derived from referencePoint
 * - NOT a hardcoded 50%/50% - so the marker tracks the real anchor for every format, present and future.
 */
export function referenceMarkerPercent(format: SourceFormat): { x: number; y: number } {
    const ref = referencePoint(format);
    return { x: (ref.x / TILE_BASE_PX) * 100, y: (ref.y / TILE_BASE_PX) * 100 };
}
