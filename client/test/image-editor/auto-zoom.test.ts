import { expect, test } from "vitest";
import {
    fitZoomByMeasuring,
    snapToLadder,
    zoomSubject,
    ZOOM_MAX,
    ZOOM_MIN,
} from "../../src/image-editor/webview/render/tile";

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

test("nothing that fits means the control's floor, not a smaller number it cannot express", async () => {
    const grid = wrappingGrid(400, 2000, 300, 200);
    expect(await fitZoomByMeasuring(ZOOM_MAX, ZOOM_MIN, grid.apply, grid.fits)).toBe(ZOOM_MIN);
});

test("the search is bounded - it cannot spend unbounded layout passes on a pathological stage", async () => {
    // Each pass is a real layout in the webview, so an unbounded halving would hang the stage rather
    // than merely take a while. The search spends the opening measurement, its fixed run of halvings,
    // and one closing apply.
    const grid = wrappingGrid(400, 2000, 300, 200);
    await fitZoomByMeasuring(ZOOM_MAX, ZOOM_MIN, grid.apply, grid.fits);
    expect(grid.applied).toBeLessThanOrEqual(10);
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

const walk = { basename: "MDKNG1", set: { id: 0x2300, action: "MDKNG1" } };
const attack = { basename: "MDKNG2", set: { id: 0x2300, action: "MDKNG2" } };

test("a different set is a different subject", () => {
    const dragon = { basename: "MDR11100", set: { id: 0x1200, action: "MDR11100" } };
    expect(zoomSubject(dragon, 0, "rose")).not.toBe(zoomSubject(walk, 0, "rose"));
});

test("a different action is a different subject - its cycles need not fit where the last one did", () => {
    expect(zoomSubject(attack, 0, "rose")).not.toBe(zoomSubject(walk, 0, "rose"));
});

test("a different direction block is a different subject", () => {
    expect(zoomSubject(walk, 1, "rose")).not.toBe(zoomSubject(walk, 0, "rose"));
});

test("rose and grid are different subjects - the grid packs the same cycles into another footprint", () => {
    expect(zoomSubject(walk, 0, "grid")).not.toBe(zoomSubject(walk, 0, "rose"));
});

test("the same drawing is the same subject, so a reader's own zoom is not overwritten under them", () => {
    expect(zoomSubject(walk, 0, "rose")).toBe(zoomSubject(walk, 0, "rose"));
});

test("a file opened on its own is keyed by name, and still by block and layout", () => {
    expect(zoomSubject({ basename: "SPGLYPH" }, 0, "rose")).not.toBe(zoomSubject({ basename: "SPFIRE" }, 0, "rose"));
    expect(zoomSubject({ basename: "SPGLYPH" }, 0, "rose")).toBe(zoomSubject({ basename: "SPGLYPH" }, 0, "rose"));
    expect(zoomSubject({ basename: "SPGLYPH" }, 2, "rose")).not.toBe(zoomSubject({ basename: "SPGLYPH" }, 0, "rose"));
});

// The sprite scale a subject starts at: the cell grid is fitted continuously, and the art inside it
// takes the largest LADDER rung that still fits its cell, so it is pixel-exact by default. Measured
// against the CELL rather than the fit, because the tile box has a floor - a tiny sprite gets a cell far
// bigger than its own art scaled, and reading the fit instead left a 16px rat drawn 1:1 in a 186px cell.
test("a small sprite's room takes the largest rung under it", () => {
    // The rat: 16px of art with a 96px cell's worth of room. Six is not a rung, so four is what it gets.
    expect(snapToLadder(6)).toBe(4);
});

test("room of exactly one rung takes that rung rather than the one below", () => {
    // The death knight: 2x would overflow, and 1x fits to the pixel. Falsified by a strict comparison.
    expect(snapToLadder(1)).toBe(1);
});

test("a sprite with less than 1:1 of room takes a rung below it rather than overflowing", () => {
    // The dragon, whose art is nearly four times the cell its nine-piece wheel leaves room for.
    expect(snapToLadder(0.259)).toBe(0.25);
});

test("room below the smallest rung falls back to the ratio itself", () => {
    // Below the ladder nothing is crisp anyway, so fitting the cell is what is left.
    expect(snapToLadder(0.05)).toBeCloseTo(0.05);
});
