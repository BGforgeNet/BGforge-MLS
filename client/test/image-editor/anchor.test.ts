import { expect, test } from "vitest";
import { type Animation, convertToFrm, emptyPalette, offsetToAnchor } from "@bgforge/image";
import { frameTopLeft, referenceMarkerPercent } from "../../src/image-editor/webview/render/anchor";

// TILE_BASE_PX is 96; these expectations are derived from the fallout2-ce anchor formula, not copied
// from current output. FRM: the anchor is bottom-centre (width/2, height-1) plus the per-DIRECTION header
// offset, placed on the reference line at 0.92*96 = 88.32. The per-FRAME offset is an animation delta and
// does NOT move the static anchor. BAM: the stored centre IS the anchor, placed at the tile centre.

test("FRM anchors a frame by its bottom-centre (width/2, height-1) on the reference line", () => {
    const tl = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 0,
        offsetY: 0,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    // anchor = (20, 75); topLeft = referencePoint(48, 88.32) - anchor
    expect(tl.x).toBeCloseTo(48 - 20); // 28
    expect(tl.y).toBeCloseTo(88.32 - 75); // 13.32 - bottom edge (height-1) on the reference line
});

test("the FRM per-direction offset shifts the anchor, but the per-frame offset is IGNORED (it is an animation delta)", () => {
    const tl = frameTopLeft({
        sourceFormat: "frm",
        width: 40,
        height: 76,
        offsetX: 3, // per-frame - must have NO effect on the static position
        offsetY: -1,
        dirOffsetX: -1,
        dirOffsetY: 2,
    });
    // anchor = (40/2 - (-1), (76-1) - 2) = (21, 73); topLeft = (48-21, 88.32-73). No per-frame contribution.
    expect(tl.x).toBeCloseTo(48 - 21); // 27
    expect(tl.y).toBeCloseTo(88.32 - 73); // 15.32
});

test("BAM places its stored centre pixel on the SAME reference line as FRM (unified preview)", () => {
    const tl = frameTopLeft({
        sourceFormat: "bam",
        width: 40,
        height: 40,
        offsetX: 20,
        offsetY: 30,
        dirOffsetX: 0,
        dirOffsetY: 0,
    });
    // The reference is format-independent now: the ground line at 0.92*96 = 88.32, not the tile centre -
    // so a BAM sprite and its FRM conversion render at the same tile position.
    expect(tl.x).toBeCloseTo(48 - 20); // 28
    expect(tl.y).toBeCloseTo(88.32 - 30); // 58.32
});

test("converting BAM->FRM preserves the anchor pixel via the per-direction offset (not the per-frame offset)", () => {
    // A 63x74 BAM frame anchored at centre (39,67) - the reported real case. The converter preserves that
    // anchor in the FRM per-DIRECTION header offset (a static adjustment), leaving the per-FRAME offset 0
    // (it is an animation delta, not the anchor). The SAME frame pixel stays on the object's ground point.
    const width = 63;
    const height = 74;
    const bam: Animation = {
        palette: emptyPalette(),
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width, height, pixels: new Uint8Array(width * height), offsetX: 39, offsetY: 67 }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    const bamAnchor = offsetToAnchor("bam", { width, height, offsetX: 39, offsetY: 67 });

    const { animation: frm } = convertToFrm(bam, { singleCycle: 0 });
    const frmFrame = frm.frames[frm.sequences[0]?.frameRefs[0] ?? 0];
    if (!frmFrame) throw new Error("expected a converted FRM frame");
    // The per-frame offset must be cleared (it is a motion delta); the anchor lives in the dir offset.
    expect(frmFrame.offsetX).toBe(0);
    expect(frmFrame.offsetY).toBe(0);
    expect(frm.meta.dirOffsetsX?.[0]).not.toBe(0); // anchor encoded in the per-direction offset
    const frmAnchor = offsetToAnchor("frm", {
        width: frmFrame.width,
        height: frmFrame.height,
        offsetX: frmFrame.offsetX,
        offsetY: frmFrame.offsetY,
        dirOffsetX: frm.meta.dirOffsetsX?.[0] ?? 0,
        dirOffsetY: frm.meta.dirOffsetsY?.[0] ?? 0,
    });
    // Same ground-anchor pixel, within the <=0.5px integer-rounding of the odd-width centre.
    expect(Math.abs(frmAnchor.ax - bamAnchor.ax)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(frmAnchor.ay - bamAnchor.ay)).toBeLessThanOrEqual(0.5);
});

test("the offset marker sits on the unified reference (ground line) - format-independent, not a fixed 50%", () => {
    // One reference for every format, so the marker lands on the sprite's real anchor and a converted
    // sprite's marker does not jump between the BAM and FRM previews.
    expect(referenceMarkerPercent()).toEqual({ x: 50, y: 92 });
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
