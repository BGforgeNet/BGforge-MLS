import { expect, test } from "vitest";
import { type Animation, convertToFrm, emptyPalette } from "@bgforge/image";
import { frameTopLeft, referenceMarkerPercent } from "../../src/image-editor/webview/render/anchor";

// TILE_BASE_PX is 96. BAM: the stored centre IS the anchor, placed at the tile CENTRE. FRM: the anchor is
// the frame's bottom-centre (width/2, height-1) plus the per-DIRECTION offset; it is placed on a "feet
// line" chosen to VERTICALLY CENTRE the frame (TILE/2 + height/2 - 1), so a feet-anchored FRM sits where a
// centre-anchored BAM of the same content sat. The per-FRAME offset is an animation delta - ignored here.

test("FRM is feet-anchored and displayed vertically centred in the tile", () => {
    const height = 76;
    const tl = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height,
        offsetX: 0,
        offsetY: 0,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    // anchor = bottom-centre (20, 75); reference = (48, 48 + 76/2 - 1 = 85); topLeft = (28, 10).
    // The 76-tall frame then spans y 10..86 - vertically centred in the 96 tile ((96-76)/2 = 10).
    expect(tl.x).toBeCloseTo(28);
    expect(tl.y).toBeCloseTo(10);
});

test("the FRM per-frame offset is IGNORED (animation delta); the per-direction offset shifts the anchor", () => {
    const base = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 0,
        offsetY: 0,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    const withPerFrame = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 9,
        offsetY: -9,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    expect(withPerFrame).toEqual(base); // per-frame offset has NO effect on the static position

    const withDir = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 0,
        offsetY: 0,
        dirOffsetX: 2,
        dirOffsetY: 3,
    });
    // anchor = (40/2 - 2, (76-1) - 3) = (18, 72); reference (48, 85); topLeft = (30, 13).
    expect(withDir.x).toBeCloseTo(30);
    expect(withDir.y).toBeCloseTo(13);
});

test("BAM places its stored centre pixel at the tile centre", () => {
    const tl = frameTopLeft({
        sourceFormat: "bam",
        width: 40,
        height: 40,
        offsetX: 20,
        offsetY: 30,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    // reference = tile centre (48,48); anchor = centre (20,30); topLeft = (28, 18).
    expect(tl.x).toBeCloseTo(28);
    expect(tl.y).toBeCloseTo(18);
});

test("converting BAM->FRM makes a proper feet-anchored file that keeps the sprite's on-tile spot", () => {
    // Bear-like: a 62x62 BAM anchored at its middle (30,30). The BAM shows it centred; the converted FRM
    // is feet-anchored (ALL offsets 0), and the editor frames it centred too, so it lands at ~the same spot.
    const width = 62;
    const height = 62;
    const bam: Animation = {
        palette: emptyPalette(),
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width, height, pixels: new Uint8Array(width * height), offsetX: 30, offsetY: 30 }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    const bamTL = frameTopLeft({
        sourceFormat: "bam",
        width,
        height,
        offsetX: 30,
        offsetY: 30,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });

    const { animation: frm } = convertToFrm(bam, { singleCycle: 0 });
    const frmFrame = frm.frames[frm.sequences[0]?.frameRefs[0] ?? 0];
    if (!frmFrame) throw new Error("expected a converted FRM frame");
    // Proper feet-anchored FRM: every offset is 0 (anchor = the frame's own bottom-centre).
    expect(frmFrame.offsetX).toBe(0);
    expect(frmFrame.offsetY).toBe(0);
    expect(frm.meta.dirOffsetsX).toEqual([0, 0, 0, 0, 0, 0]);
    expect(frm.meta.dirOffsetsY).toEqual([0, 0, 0, 0, 0, 0]);

    const frmTL = frameTopLeft({
        sourceFormat: "frm",
        width: frmFrame.width,
        height: frmFrame.height,
        offsetX: 0,
        offsetY: 0,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    // Same on-tile spot, within the <=1px geometric-centre-vs-stored-centre difference.
    expect(Math.abs(frmTL.x - bamTL.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frmTL.y - bamTL.y)).toBeLessThanOrEqual(1);
});

test("the offset marker sits on each format's anchor: BAM at the tile centre, FRM at the feet line", () => {
    expect(referenceMarkerPercent("bam", 62)).toEqual({ x: 50, y: 50 });
    expect(referenceMarkerPercent("bamc", 62)).toEqual({ x: 50, y: 50 });
    // FRM feet line for a 62-tall frame = (48 + 62/2 - 1) / 96 = 78/96.
    expect(referenceMarkerPercent("frm", 62).x).toBeCloseTo(50);
    expect(referenceMarkerPercent("frm", 62).y).toBeCloseTo((78 / 96) * 100); // ~81.25%
});

test("BAMC uses the same tile-centre anchor as BAM", () => {
    const geom = { width: 10, height: 10, offsetX: 5, offsetY: 5, dirOffsetX: 0, dirOffsetY: 0 } as const;
    expect(frameTopLeft({ sourceFormat: "bamc", ...geom })).toEqual(frameTopLeft({ sourceFormat: "bam", ...geom }));
});
