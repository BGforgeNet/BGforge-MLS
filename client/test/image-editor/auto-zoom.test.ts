import { expect, test } from "vitest";
import { autoZoomLevel } from "../../src/image-editor/webview/render/tile";

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

test("a large 64-cycle grid never zooms (composite already exceeds the stage)", () => {
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
