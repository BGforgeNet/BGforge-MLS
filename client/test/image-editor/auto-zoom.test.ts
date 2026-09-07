import { expect, test } from "vitest";
import { autoZoomLevel, fitZoomByMeasuring, ZOOM_MIN } from "../../src/image-editor/webview/render/tile";

// The stage the incident happened on: ~1200x800 inner, usar1ca's rose (384px composite, 90x78 sprites).
const STAGE = { availW: 1176, availH: 776, cap: 4 };

test("a lone small sprite zooms to the cap (the original auto-zoom behavior)", () => {
    // Single-tile layout: composite ~= one 96px tile, sprite 30x30 - plenty of room to quadruple.
    const z = autoZoomLevel({ maxFrameW: 30, maxFrameH: 30, contentW: 100, contentH: 120, ...STAGE });
    expect(z).toBe(4);
});

test("a creature rose is clamped by the composite bound, not sized by it", () => {
    // usar1ca's shape: sprite rule wants x4 (90x78 frames well under half the stage), but the 384px rose
    // composite overflows at x4 (1536) and fits at x2 (768 vs 1176x776) - clamped to x2.
    const z = autoZoomLevel({ maxFrameW: 90, maxFrameH: 78, contentW: 384, contentH: 384, ...STAGE });
    expect(z).toBe(2);
});

test("the composite bound can clamp all the way back to 100%", () => {
    const z = autoZoomLevel({
        maxFrameW: 90,
        maxFrameH: 78,
        contentW: 384,
        contentH: 384,
        availW: 1176,
        availH: 700, // 384*2 = 768 > 700: even x2 overflows vertically
        cap: 4,
    });
    expect(z).toBe(1);
});

test("a large 64-cycle grid never zooms up (composite already exceeds the stage)", () => {
    // Shrinking below 100% is fitZoomByMeasuring's job - this one only decides how far UP to go.
    const z = autoZoomLevel({ maxFrameW: 90, maxFrameH: 78, contentW: 1600, contentH: 1700, ...STAGE });
    expect(z).toBe(1);
});

test("a sprite already at half the stage does not zoom", () => {
    const z = autoZoomLevel({ maxFrameW: 600, maxFrameH: 400, contentW: 600, contentH: 400, ...STAGE });
    expect(z).toBe(1);
});

test("degenerate inputs (no frames, unmeasured stage) stay at 100%", () => {
    expect(autoZoomLevel({ maxFrameW: 0, maxFrameH: 0, contentW: 0, contentH: 0, ...STAGE })).toBe(1);
    expect(
        autoZoomLevel({ maxFrameW: 30, maxFrameH: 30, contentW: 96, contentH: 96, availW: 0, availH: 0, cap: 4 }),
    ).toBe(1);
});

/**
 * A stand-in for the real stage: `count` uniform tiles of `tileBase` laid out by a wrapping grid, which
 * is the layout whose footprint is NOT linear in zoom - the whole reason the fit is measured. Returns
 * whether the wrapped layout fits, exactly as reading the DOM box back would.
 */
function wrappingGrid(count: number, tileBase: number, availW: number, availH: number) {
    let zoom = 1;
    let applied = 0;
    return {
        get zoom() {
            return zoom;
        },
        get applied() {
            return applied;
        },
        apply: async (next: number): Promise<void> => {
            zoom = next;
            applied++;
        },
        fits: (): boolean => {
            const tile = tileBase * zoom;
            const columns = Math.max(1, Math.floor(availW / tile));
            return tile <= availW && Math.ceil(count / columns) * tile <= availH;
        },
    };
}

test("a layout that already fits is left at the zoom it was handed", async () => {
    const grid = wrappingGrid(4, 96, 1176, 776);
    expect(await fitZoomByMeasuring(2, ZOOM_MIN, grid.apply, grid.fits)).toBe(2);
    expect(grid.zoom).toBe(2);
});

test("a nine-tile creature stance shrinks to a third, not to the floor", async () => {
    // The dragon: nine 790px tiles in a 920x776 stage. At 100% the grid wraps one tile per row and
    // measures 7110 tall, so scaling that single measurement would land on the floor; three tiles per
    // row at a third of the size fits, and that is what measuring each candidate finds.
    const grid = wrappingGrid(9, 790, 920, 776);
    const z = await fitZoomByMeasuring(1, ZOOM_MIN, grid.apply, grid.fits);
    expect(z).toBeGreaterThan(0.3);
    expect(z).toBeLessThanOrEqual(0.33);
    expect(grid.zoom).toBe(z);
    expect(grid.fits()).toBe(true);
});

test("nothing that fits means the control's floor, not a smaller number it cannot express", async () => {
    const grid = wrappingGrid(400, 2000, 300, 200);
    expect(await fitZoomByMeasuring(1, ZOOM_MIN, grid.apply, grid.fits)).toBe(ZOOM_MIN);
});

test("the search is bounded - it cannot spend unbounded layout passes on a pathological stage", async () => {
    const grid = wrappingGrid(9, 790, 920, 776);
    await fitZoomByMeasuring(4, ZOOM_MIN, grid.apply, grid.fits);
    expect(grid.applied).toBeLessThanOrEqual(10);
});
