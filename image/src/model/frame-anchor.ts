import { type SourceFormat } from "./animation.ts";

/**
 * The format-neutral frame anchor: the pixel (measured from the frame's top-left, unzoomed) that lands
 * on the game's placement/reference point. Each format encodes this SAME anchor differently in its raw
 * per-frame offset fields, so this module is the ONE place that knows the mapping. Both consumers read
 * it - the renderer (to place a frame within its tile) and the cross-format converters (to preserve the
 * anchor across a format change) - so the two conventions cannot drift apart.
 *
 * FRM: the engine anchors a sprite by its feet - horizontally centered (width/2), bottom edge (height) -
 * then shifts by the per-direction header offset and the per-frame offset. Verified against fallout2-ce
 * object.cc (see the renderer's anchor.ts, which builds its tile position from this anchor).
 * BAM: the stored per-frame offset IS the anchor pixel, directly.
 *
 * Adding a SourceFormat: declare its anchor in BOTH switches below. The `never` default makes an
 * undeclared format a COMPILE error here (and only here) rather than one that silently inherits another
 * format's convention - which is the exact bug this module exists to prevent (a BAM center-pixel written
 * verbatim into an FRM per-frame shift displaced every converted sprite).
 */
export interface AnchorGeom {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    /** FRM per-direction header offset; 0/absent for formats without per-direction offsets (BAM). */
    dirOffsetX?: number;
    dirOffsetY?: number;
}

export interface Anchor {
    ax: number;
    ay: number;
}

/** A format's raw per-frame offset -> the format-neutral anchor pixel (from the frame's top-left). */
export function offsetToAnchor(format: SourceFormat, g: AnchorGeom): Anchor {
    switch (format) {
        case "frm":
            return {
                ax: g.width / 2 - (g.dirOffsetX ?? 0) - g.offsetX,
                ay: g.height - (g.dirOffsetY ?? 0) - g.offsetY,
            };
        case "bam":
        case "bamc":
            return { ax: g.offsetX, ay: g.offsetY };
        default: {
            const unhandled: never = format;
            throw new Error(`offsetToAnchor: unhandled sourceFormat ${String(unhandled)}`);
        }
    }
}

/**
 * The inverse, for a conversion TARGET: the format-neutral anchor -> the raw per-frame offset a frame of
 * this size needs to land on that anchor. The target's per-direction offset is taken as zero - the
 * converters fold all positioning into the per-frame offset and zero the FRM header offsets - so this is
 * the exact inverse of offsetToAnchor with dirOffset 0. Rounds to the integer the on-disk int16 offset
 * fields require; the <=0.5px error is unavoidable when width is odd and cannot round-trip losslessly.
 */
export function anchorToOffset(
    format: SourceFormat,
    a: Anchor & { width: number; height: number },
): { offsetX: number; offsetY: number } {
    switch (format) {
        case "frm":
            return { offsetX: Math.round(a.width / 2 - a.ax), offsetY: Math.round(a.height - a.ay) };
        case "bam":
        case "bamc":
            return { offsetX: Math.round(a.ax), offsetY: Math.round(a.ay) };
        default: {
            const unhandled: never = format;
            throw new Error(`anchorToOffset: unhandled sourceFormat ${String(unhandled)}`);
        }
    }
}

/**
 * Re-express one frame's per-frame offset from a source format's convention into a target format's, so
 * the frame keeps the SAME on-screen anchor. `srcDirOffset` is the source frame's per-direction offset
 * (FRM header offset for that direction; 0 for BAM). The target's per-direction offset is zero.
 */
export function translateFrameOffset(
    source: SourceFormat,
    target: SourceFormat,
    frame: { width: number; height: number; offsetX: number; offsetY: number },
    srcDirOffset?: { x: number; y: number },
): { offsetX: number; offsetY: number } {
    const anchor = offsetToAnchor(source, {
        width: frame.width,
        height: frame.height,
        offsetX: frame.offsetX,
        offsetY: frame.offsetY,
        dirOffsetX: srcDirOffset?.x ?? 0,
        dirOffsetY: srcDirOffset?.y ?? 0,
    });
    return anchorToOffset(target, { ...anchor, width: frame.width, height: frame.height });
}
