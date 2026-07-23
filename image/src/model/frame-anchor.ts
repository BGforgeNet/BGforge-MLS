import { type SourceFormat } from "./animation.ts";

/**
 * The format-neutral frame anchor: the pixel (measured from the frame's top-left, unzoomed) that lands
 * on the game's placement/reference point. Each format encodes this SAME anchor differently, so this
 * module is the ONE place that knows the mapping. Both consumers read it - the renderer (to place a
 * frame within its tile) and the cross-format converters - so the two conventions cannot drift apart.
 *
 * FRM: the anchor is the frame's bottom-centre - `(width/2, height-1)` - adjusted by the per-DIRECTION
 * header offset (`x_offsets[6]`/`y_offsets[6]`, a static base adjustment per rotation). Verified against
 * fallout2-ce object.cc: base `sx = screenX - width/2`, `sy = screenY - (height-1)`. The per-FRAME x/y
 * offset is an animation MOTION DELTA accumulated only as the animation advances (`obj->sx += x`), NOT
 * part of the static anchor, so `offsetToAnchor` deliberately does NOT read it.
 * BAM: the stored per-frame centre coordinate (`Frame center X/Y`) IS the anchor, directly.
 *
 * Adding a SourceFormat: declare its anchor in offsetToAnchor below. The `never` default makes an
 * undeclared format a COMPILE error here (and only here) rather than one that silently inherits another
 * format's convention.
 */
export interface AnchorGeom {
    width: number;
    height: number;
    /** BAM: the frame's centre pixel (the anchor). FRM: the per-frame animation delta - NOT the anchor. */
    offsetX: number;
    offsetY: number;
    /** FRM per-direction header offset (static base adjustment); 0/absent for BAM. */
    dirOffsetX?: number;
    dirOffsetY?: number;
}

export interface Anchor {
    ax: number;
    ay: number;
}

/** The pixel (from the frame's top-left) that lands on the game's reference point - the format-neutral anchor. */
export function offsetToAnchor(format: SourceFormat, g: AnchorGeom): Anchor {
    switch (format) {
        case "frm":
            // Bottom-centre plus the per-direction base offset. The per-FRAME offset is an animation
            // delta and is intentionally not part of the anchor.
            return { ax: g.width / 2 - (g.dirOffsetX ?? 0), ay: g.height - 1 - (g.dirOffsetY ?? 0) };
        case "bam":
        case "bamc":
            return { ax: g.offsetX, ay: g.offsetY };
        default: {
            const unhandled: never = format;
            throw new Error(`offsetToAnchor: unhandled sourceFormat ${String(unhandled)}`);
        }
    }
}
