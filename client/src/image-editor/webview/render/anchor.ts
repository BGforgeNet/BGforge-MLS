import type { SourceFormat } from "@bgforge/image";
import { TILE_BASE_PX } from "./tile";

/**
 * Where a frame's top-left corner sits (unzoomed px) within its TILE_BASE_PX tile, so it renders as
 * the game positions it. The two formats anchor differently and this is a real domain difference, not
 * drift - both go through this one helper so the renderer stays format-agnostic.
 *
 * FRM: the engine anchors a sprite by its feet - horizontally centered on a reference point, bottom
 * edge on it - then shifts by the per-direction header offset and the per-frame offset. Verified
 * against fallout2-ce object.cc: `rect.left = ref.x - width/2 + dirOff + frameOff`,
 * `rect.top = ref.y - (height - 1) + dirOff + frameOff`. The reference sits low in the tile
 * (FRM_FEET_FRACTION) so a bottom-anchored sprite stays framed. Per-frame offsets are applied directly
 * rather than accumulated across the loop: the game's forward motion comes from the object's changing
 * world tile, which a fixed-tile preview does not simulate, so accumulating would only drift the
 * sprite out of frame.
 *
 * BAM: each frame stores an explicit center pixel that lands on the reference (BAM parse copies it into
 * offsetX/offsetY), so the sprite anchors at the tile center by that pixel.
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

export function frameTopLeft(a: AnchorInput): { x: number; y: number } {
    // Exhaustive by SourceFormat on purpose: a new format must DECLARE its anchor here (compile error
    // in the default arm otherwise) rather than silently inherit another format's convention - which is
    // how FRM once inherited BAM's center-pixel anchor and rendered every sprite off its tile.
    switch (a.sourceFormat) {
        case "frm":
            return {
                x: TILE_BASE_PX / 2 - a.width / 2 + a.dirOffsetX + a.offsetX,
                y: TILE_BASE_PX * FRM_FEET_FRACTION - a.height + a.dirOffsetY + a.offsetY,
            };
        case "bam":
        case "bamc":
            // The stored offset IS the center pixel that lands on the reference (tile center).
            return { x: TILE_BASE_PX / 2 - a.offsetX, y: TILE_BASE_PX / 2 - a.offsetY };
        default: {
            const unhandled: never = a.sourceFormat;
            throw new Error(`frameTopLeft: unhandled sourceFormat ${String(unhandled)}`);
        }
    }
}
