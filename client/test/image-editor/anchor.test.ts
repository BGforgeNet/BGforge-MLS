import { expect, test } from "vitest";
import { frameTopLeft } from "../../src/image-editor/webview/render/anchor";

// TILE_BASE_PX is 96; these expectations are derived from the fallout2-ce anchor formula, not copied
// from current output. FRM: horizontally centered (48 - width/2), feet on the reference line at
// 0.92*96 = 88.32 (top = 88.32 - height), plus the direction and per-frame offsets. BAM: the stored
// offset IS the center pixel, placed at the tile center (48 - offset).

test("FRM anchors a frame by its feet: centered X, bottom on the reference, offsets applied", () => {
    const tl = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 0,
        offsetY: 0,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    expect(tl.x).toBeCloseTo(48 - 20); // 28
    expect(tl.y).toBeCloseTo(88.32 - 76); // 12.32 - the sprite sits on its checkered tile, not off it
});

test("FRM direction and per-frame offsets shift the feet anchor", () => {
    const tl = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 3,
        offsetY: -1,
        dirOffsetX: -1,
        dirOffsetY: 2,
    });
    expect(tl.x).toBeCloseTo(48 - 20 + -1 + 3); // 30
    expect(tl.y).toBeCloseTo(88.32 - 76 + 2 + -1); // 13.32
});

test("BAM places its stored center pixel on the tile center - a different convention from FRM", () => {
    const tl = frameTopLeft({
        sourceFormat: "bam",
        width: 40,
        height: 40,
        offsetX: 20,
        offsetY: 30,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    expect(tl.x).toBeCloseTo(48 - 20); // 28
    expect(tl.y).toBeCloseTo(48 - 30); // 18
});

test("BAMC uses the same center-pixel anchor as BAM", () => {
    const bam = frameTopLeft({
        sourceFormat: "bam",
        width: 10,
        height: 10,
        offsetX: 5,
        offsetY: 5,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    const bamc = frameTopLeft({
        sourceFormat: "bamc",
        width: 10,
        height: 10,
        offsetX: 5,
        offsetY: 5,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    expect(bamc).toEqual(bam);
});
