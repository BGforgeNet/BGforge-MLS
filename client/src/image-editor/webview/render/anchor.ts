import type { SourceFormat } from "@bgforge/image";
// Import the pure anchor helper from its dedicated subpath, NOT the "@bgforge/image" barrel: the barrel
// re-exports the png/bamc codecs (Node Buffer/zlib) which crash a browser webview bundle on load.
import { offsetToAnchor } from "@bgforge/image/frame-anchor";
import { TILE_BASE_PX } from "./tile";

/**
 * Where a frame's top-left corner sits (unzoomed px) within its TILE_BASE_PX tile, so it renders as the
 * game positions it. topLeft = REFERENCE - anchor, where the anchor (which frame pixel lands on the
 * reference) is computed per-format by `offsetToAnchor` in @bgforge/image - the SAME function the
 * cross-format converters use, so a preview and a Save-As can never disagree on where a sprite sits.
 *
 * The REFERENCE point (the object's placement position within the tile) is format-INDEPENDENT. Both the
 * Fallout and Infinity Engine engines draw a sprite anchored at the same placement point, so using ONE
 * reference for every format makes the preview reflect that consistent cross-engine display: a sprite and
 * its BAM<->FRM conversion render identically here, the way both engines actually draw them. It sits low
 * in the tile (a "ground line") so a feet-anchored sprite stands on it, while a centre-anchored one (a
 * spell effect, projectile) hangs relative to it - exactly as each does in-game. The per-FORMAT quantity
 * is the ANCHOR (offsetToAnchor's FRM-bottom-centre vs BAM-centre), never this reference.
 */
const GROUND_LINE_FRACTION = 0.92;
const REFERENCE = { x: TILE_BASE_PX / 2, y: TILE_BASE_PX * GROUND_LINE_FRACTION };

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
    const { ax, ay } = offsetToAnchor(a.sourceFormat, a);
    return { x: REFERENCE.x - ax, y: REFERENCE.y - ay };
}

/**
 * The reference point as a percentage of the tile, for positioning the offset marker so it sits exactly
 * where the sprite's anchor lands. Format-independent, like REFERENCE itself - NOT a hardcoded 50%/50%.
 */
export function referenceMarkerPercent(): { x: number; y: number } {
    return { x: (REFERENCE.x / TILE_BASE_PX) * 100, y: (REFERENCE.y / TILE_BASE_PX) * 100 };
}
