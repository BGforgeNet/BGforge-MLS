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
/**
 * One-click levels, ascending - and the ladder the automatic fit walks down.
 *
 * Every rung is a power of two, which is what keeps a sprite crisp: the canvas holds the frame at native
 * resolution and CSS scales it with `image-rendering: pixelated`, so a whole-number factor maps each
 * source pixel to an exact block and a halving averages a whole block down. The fractional zooms between
 * them render some source pixels wider than others, which reads as a ragged sprite.
 */
export const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4];

/** Halvings of the range the fit search spends; 7 resolves it to within a couple of percent. */
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

/**
 * The sprite scale a freshly fitted subject starts at: the largest ladder rung the room allows.
 *
 * The cell grid is fitted to the stage continuously - a cell is a plain rectangle, and stopping it on a
 * rung would leave the stage part empty for nothing. The ART inside it is what has to stay pixel-exact
 * (ZOOM_PRESETS), so it takes a rung. `room` is what the cell really has for it (`spriteFillRatio`, which
 * measures against the anchor rather than the art's own size), so the automatic choice and the Fill
 * control read the same number and cannot disagree about what fits.
 *
 * Below the smallest rung nothing is crisp anyway, so an oversized sprite takes the plain ratio that
 * fits rather than overflowing the cell the grid reserved for it.
 */
export function snapToLadder(room: number): number {
    return ZOOM_PRESETS.findLast((preset) => preset <= room) ?? room;
}

/**
 * What a view is auto-fitted FOR - everything that changes the drawn composite's footprint.
 *
 * The stage is mounted once and a selection arrives as another view, so the fit has to be told when it
 * is looking at a new picture: a different set (a small creature inheriting a dragon's fit is drawn
 * microscopic, which is the report), a different action, a different direction block, or the same
 * cycles packed into the other layout. What is NOT in here is the reader's own controls - zoom,
 * background, marker - and the armour level, which redraws one creature's own equipment at its size.
 */
export function zoomSubject(
    view: { basename: string; set?: { id: number; action: string } },
    block: number,
    layout: string,
): string {
    const drawn = view.set === undefined ? `file:${view.basename}` : `set:${view.set.id}/${view.set.action}`;
    return `${drawn}#${block}@${layout}`;
}
