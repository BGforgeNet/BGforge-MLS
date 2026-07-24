/**
 * The fixed unzoomed footprint (px) each frame is centered within. Shared so every layout sizes its
 * cells uniformly (CompassRose derives its circle radius from it, CycleGrid its cell size) and every
 * frame anchors at the same on-screen point regardless of its own width/height (FrameCanvas centers
 * within it).
 */
export const TILE_BASE_PX = 96;

/**
 * Auto-zoom for a freshly opened view. The target is SPRITE legibility: double while the largest frame
 * still renders under half the stage - not the composite, which for a rose/grid is already several
 * tiles wide (doubling a 4-tile composite overflows the stage; the incident that split this out).
 * The composite footprint then only BOUNDS the result: halve back until the whole layout fits.
 * All sizes scale linearly with zoom, so both checks work from zoom-1 measurements.
 */
export function autoZoomLevel(args: {
    maxFrameW: number;
    maxFrameH: number;
    contentW: number; // composite footprint at zoom 1
    contentH: number;
    availW: number; // stage size with padding already subtracted
    availH: number;
    cap: number;
}): number {
    const { maxFrameW, maxFrameH, contentW, contentH, availW, availH, cap } = args;
    if (maxFrameW <= 0 || maxFrameH <= 0 || availW <= 0 || availH <= 0) return 1;
    let z = 1;
    while (z < cap && maxFrameW * z < availW / 2 && maxFrameH * z < availH / 2) z *= 2;
    while (z > 1 && (contentW * z > availW || contentH * z > availH)) z /= 2;
    return z;
}
