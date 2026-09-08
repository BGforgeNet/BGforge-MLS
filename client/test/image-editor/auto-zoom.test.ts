import { expect, test } from "vitest";
import {
    autoZoom,
    fitZoomByMeasuring,
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

test("auto fills the tile where the art is large enough to need most of it", () => {
    // The knight: a shade over 1:1 of its tile at the layout scale it is drawn.
    expect(autoZoom(3.5, 0.34)).toBeCloseTo(1.19);
});

test("auto stops at the top of the control, however much room a small sprite has", () => {
    // The rat measured 683% of its tile before this - a sprite blown up that far is more block than
    // picture, and it was a scale the presets could not even offer.
    expect(autoZoom(20, 0.34)).toBe(ZOOM_MAX);
});

test("another creature is another subject, so it is fitted rather than inheriting the last one's scale", () => {
    const dragon = { basename: "MDR11100", set: { id: 0x1200, action: "MDR11100" } };
    expect(zoomSubject(dragon)).not.toBe(zoomSubject(walk));
});

test("another ACTION of the same creature is the same subject - the reader's zoom is left alone", () => {
    // The whole point of the fixed tile: G1 and G2 stand in tiles of one size at one anchor, so there is
    // nothing to re-fit between them. Falsified by keying on the action - this then reports two subjects.
    expect(zoomSubject(attack)).toBe(zoomSubject(walk));
});

test("a file opened on its own is keyed by its name", () => {
    expect(zoomSubject({ basename: "SPGLYPH" })).not.toBe(zoomSubject({ basename: "SPFIRE" }));
    expect(zoomSubject({ basename: "SPGLYPH" })).toBe(zoomSubject({ basename: "SPGLYPH" }));
});
