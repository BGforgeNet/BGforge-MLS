/**
 * The fixed unzoomed footprint (px) each frame is centered within. Shared so every layout sizes its
 * cells uniformly (CompassRose derives its circle radius from it, CycleGrid its cell size) and every
 * frame anchors at the same on-screen point regardless of its own width/height (FrameCanvas centers
 * within it).
 */
export const TILE_BASE_PX = 96;

/**
 * The zoom ladder, defined here beside the auto-zoom that has to respect it - the control and the
 * automatic choice must not be able to disagree about the range.
 *
 * The floor is 10% rather than 50% because a stance's composite is nine tiles wide and each tile
 * stretches to the sprite's own anchor: a large creature needs roughly a third of full size before the
 * whole layout is on screen, and the floor must not be what stops auto-zoom fitting it.
 */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.05;
/** One-click levels, spanning the range; the slider covers everything between. */
export const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4];

/**
 * The zoom to START a freshly opened view at - the largest that sprite legibility asks for.
 *
 * The target is the SPRITE: double while the largest frame still renders under half the stage, not the
 * composite, which for a rose/grid is already several tiles wide (doubling a 4-tile composite overflows
 * the stage; the incident that split this out). The composite footprint then bounds the result from
 * above: halve back while the whole layout overflows.
 *
 * This never goes below 100%, because the halving is scaled from ONE zoom-1 measurement and a layout's
 * footprint is not linear in zoom once it wraps. Shrinking to fit is `fitZoomByMeasuring`.
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

/** Halvings of the range the fit search spends; 7 resolves the ladder to within a couple of percent. */
const FIT_SEARCH_STEPS = 7;

/**
 * The largest zoom at which the whole layout fits, found by MEASURING each candidate.
 *
 * A wrapping grid re-flows as its tiles shrink, so its footprint is not linear in zoom: nine tiles the
 * width of the stage measure one per row at 100% and three per row at a third of that. Scaling a single
 * zoom-1 measurement therefore lands at the floor for a layout that would comfortably fit at a third -
 * which is what this replaced. Measuring costs a layout pass per step and happens once per opened view.
 *
 * `apply` puts a zoom on screen and resolves once it is laid out; `fits` reads back whether it fits.
 * `min` is returned when nothing does, since the control cannot go lower anyway.
 */
export async function fitZoomByMeasuring(
    from: number,
    min: number,
    apply: (zoom: number) => Promise<void>,
    fits: () => boolean,
): Promise<number> {
    await apply(from);
    if (fits()) return from;
    let lo = min;
    let hi = from;
    for (let i = 0; i < FIT_SEARCH_STEPS; i++) {
        // Floored to a whole percent: the control reads in percent, and rounding up would hand back the
        // overflow this is removing.
        const mid = Math.floor(((lo + hi) / 2) * 100) / 100;
        if (mid <= lo || mid >= hi) break;
        // A search, not a batch: each candidate is chosen from the previous one's measurement.
        // eslint-disable-next-line no-await-in-loop -- sequential by nature; nothing to parallelise
        await apply(mid);
        if (fits()) lo = mid;
        else hi = mid;
    }
    await apply(lo);
    return lo;
}
