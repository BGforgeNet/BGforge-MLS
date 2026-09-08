import { expect, test } from "vitest";
import { type IndexedAnimation, convertToFrm, emptyPalette } from "@bgforge/image";
import {
    frameTopLeft,
    referenceMarkerPercent,
    spriteFillRatio,
    spriteRect,
    TILE_BOX,
    type TileBox,
} from "../../src/image-editor/webview/render/anchor";

/** The old square tile, as a box: what every position case below was written against. */
const SQUARE_96: TileBox = { w: 96, h: 96, refX: 48, refY: 48 };

// TILE_BASE_PX is 96. BAM: the stored centre IS the anchor, placed at the tile CENTRE. FRM: the anchor is
// the frame's bottom-centre (width/2, height-1) plus the per-DIRECTION offset; it is placed on a "feet
// line" chosen to VERTICALLY CENTRE the frame (TILE/2 + height/2 - 1), so a feet-anchored FRM sits where a
// centre-anchored BAM of the same content sat. The per-FRAME offset is an animation delta - ignored here.

test("FRM is feet-anchored and displayed vertically centred in the tile", () => {
    const height = 76;
    const tl = frameTopLeft(
        {
            sourceFormat: "frm",
            width: 40,
            height,
            offsetX: 0,
            offsetY: 0,
            dirOffsetX: 0,
            dirOffsetY: 0,
        },
        SQUARE_96,
    );
    // anchor = bottom-centre (20, 75); reference = (48, 48 + 76/2 - 1 = 85); topLeft = (28, 10).
    // The 76-tall frame then spans y 10..86 - vertically centred in the 96 tile ((96-76)/2 = 10).
    expect(tl.x).toBeCloseTo(28);
    expect(tl.y).toBeCloseTo(10);
});

test("the FRM per-frame offset is IGNORED (animation delta); the per-direction offset shifts the anchor", () => {
    const base = frameTopLeft(
        {
            sourceFormat: "frm",
            width: 40,
            height: 76,
            offsetX: 0,
            offsetY: 0,
            dirOffsetX: 0,
            dirOffsetY: 0,
        },
        SQUARE_96,
    );
    const withPerFrame = frameTopLeft(
        {
            sourceFormat: "frm",
            width: 40,
            height: 76,
            offsetX: 9,
            offsetY: -9,
            dirOffsetX: 0,
            dirOffsetY: 0,
        },
        SQUARE_96,
    );
    expect(withPerFrame).toEqual(base); // per-frame offset has NO effect on the static position

    const withDir = frameTopLeft(
        {
            sourceFormat: "frm",
            width: 40,
            height: 76,
            offsetX: 0,
            offsetY: 0,
            dirOffsetX: 2,
            dirOffsetY: 3,
        },
        SQUARE_96,
    );
    // anchor = (40/2 - 2, (76-1) - 3) = (18, 72); reference (48, 85); topLeft = (30, 13).
    expect(withDir.x).toBeCloseTo(30);
    expect(withDir.y).toBeCloseTo(13);
});

test("BAM places its stored centre pixel at the tile centre", () => {
    const tl = frameTopLeft(
        {
            sourceFormat: "bam",
            width: 40,
            height: 40,
            offsetX: 20,
            offsetY: 30,
            dirOffsetX: 0,
            dirOffsetY: 0,
        },
        SQUARE_96,
    );
    // reference = tile centre (48,48); anchor = centre (20,30); topLeft = (28, 18).
    expect(tl.x).toBeCloseTo(28);
    expect(tl.y).toBeCloseTo(18);
});

test("converting BAM->FRM makes a feet-anchored file that keeps the sprite's on-tile spot", () => {
    // Bear-like: a 62x62 BAM anchored at its middle (30,30). The BAM shows it centred; the converted
    // FRM keeps per-frame offsets 0 (motion deltas), carries the horizontal anchor in the direction
    // header offset (62/2 - 30 = 1 here), and the editor frames it so it lands at ~the same spot.
    const width = 62;
    const height = 62;
    const bam: IndexedAnimation = {
        palette: emptyPalette(),
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width, height, pixels: new Uint8Array(width * height), offsetX: 30, offsetY: 30 }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    const bamTL = frameTopLeft(
        {
            sourceFormat: "bam",
            width,
            height,
            offsetX: 30,
            offsetY: 30,
            dirOffsetX: 0,
            dirOffsetY: 0,
        },
        SQUARE_96,
    );

    const { animation: frm } = convertToFrm(bam, { singleCycle: 0 });
    const frmFrame = frm.frames[frm.sequences[0]?.frameRefs[0] ?? 0];
    if (!frmFrame) throw new Error("expected a converted FRM frame");
    // Per-frame offsets stay 0 (they are motion deltas); the BAM's horizontal centre anchor rides the
    // per-direction header offset instead, and the vertical anchor is the canvas bottom (feet).
    expect(frmFrame.offsetX).toBe(0);
    expect(frmFrame.offsetY).toBe(0);
    expect(frm.meta.dirOffsetsX).toEqual([1, 1, 1, 1, 1, 1]); // round(62/2 + (0 - 30))
    expect(frm.meta.dirOffsetsY).toEqual([0, 0, 0, 0, 0, 0]);

    const frmTL = frameTopLeft(
        {
            sourceFormat: "frm",
            width: frmFrame.width,
            height: frmFrame.height,
            offsetX: 0,
            offsetY: 0,
            dirOffsetX: frm.meta.dirOffsetsX?.[0] ?? 0,
            dirOffsetY: frm.meta.dirOffsetsY?.[0] ?? 0,
        },
        SQUARE_96,
    );
    // Same on-tile spot: horizontally exact via the direction offset, vertically within the <=1px
    // centre-vs-feet framing difference.
    expect(Math.abs(frmTL.x - bamTL.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frmTL.y - bamTL.y)).toBeLessThanOrEqual(1);
});

test("the offset marker sits on each format's anchor: BAM at the tile centre, FRM at the feet line", () => {
    expect(referenceMarkerPercent("bam", 62, SQUARE_96)).toEqual({ x: 50, y: 50 });
    expect(referenceMarkerPercent("bamc", 62, SQUARE_96)).toEqual({ x: 50, y: 50 });
    // FRM feet line for a 62-tall frame = (48 + 62/2 - 1) / 96 = 78/96.
    expect(referenceMarkerPercent("frm", 62, SQUARE_96).x).toBeCloseTo(50);
    expect(referenceMarkerPercent("frm", 62, SQUARE_96).y).toBeCloseTo((78 / 96) * 100); // ~81.25%
});

const oneFrameView = (frame: { width: number; height: number; offsetX: number; offsetY: number }) => ({
    sourceFormat: "bam" as const,
    frames: [frame],
    sequences: [{ frameRefs: [0], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 }],
});

test("every animation gets the same tile, with the anchor a quarter of the way up it", () => {
    // The whole placement rule: one square, the sprite's ground point at a fixed spot in it. Nothing about
    // the art enters, so no switch of action, sequence or animation can move the tile or the feet in it.
    expect(TILE_BOX.w).toBe(TILE_BOX.h);
    expect(TILE_BOX.refX).toBeCloseTo(TILE_BOX.w / 2);
    expect(TILE_BOX.refY).toBeCloseTo(TILE_BOX.h * 0.75);
});

test("the marker draws where the anchor is placed, a quarter of the way up", () => {
    expect(referenceMarkerPercent("bam", 62, TILE_BOX)).toEqual({ x: 50, y: 75 });
});

test("a sprite standing on its anchor gets the three quarters of the tile above it", () => {
    // A true ground-point sprite: 100 tall, anchored at its own bottom. Nothing of it is below the feet,
    // so what bounds it is the room ABOVE - the 75% of the tile the placement reserves for a body.
    const view = oneFrameView({ width: 40, height: 100, offsetX: 20, offsetY: 99 });
    expect(spriteFillRatio(view, TILE_BOX)).toBeCloseTo(TILE_BOX.refY / 99);
});

test("art hanging BELOW the anchor is bounded by the quarter tile under the feet", () => {
    // An IE creature's stored centre sits in its body, with shadow below it. That overhang has only the
    // bottom quarter to live in, and for a centre-anchored sprite it is the tighter of the four bounds.
    const view = oneFrameView({ width: 40, height: 40, offsetX: 20, offsetY: 20 });
    expect(spriteFillRatio(view, TILE_BOX)).toBeCloseTo((TILE_BOX.h - TILE_BOX.refY) / 20);
});

test("the fill ratio takes the tightest side, so no frame of the sequence clips", () => {
    // A wide sprite whose width runs out before its height does. Falsified by taking any single axis.
    const view = oneFrameView({ width: 400, height: 40, offsetX: 200, offsetY: 20 });
    expect(spriteFillRatio(view, TILE_BOX)).toBeCloseTo(TILE_BOX.refX / 200);
});

test("the fill ratio of an animation that draws nothing is 1", () => {
    const view = { sourceFormat: "bam" as const, frames: [], sequences: [] };
    expect(spriteFillRatio(view, TILE_BOX)).toBe(1);
});

test("at the fill scale every frame of the sequence is inside its tile", () => {
    // What the fill ratio promises, stated at the consumer: no facing and no frame clips at the scale a
    // view opens on. Two frames reaching opposite ways from one anchor, so a bound taken on either alone
    // would let the other out.
    const view = {
        sourceFormat: "bam" as const,
        frames: [
            { width: 40, height: 100, offsetX: 20, offsetY: 99 }, // stands on its anchor
            { width: 60, height: 80, offsetX: 30, offsetY: 10 }, // hangs below it
        ],
        sequences: [{ frameRefs: [0, 1], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 }],
    };
    const scale = spriteFillRatio(view, TILE_BOX);
    for (const frame of view.frames) {
        const rect = spriteRect({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, TILE_BOX, 1, scale);
        expect(rect.left).toBeGreaterThanOrEqual(-0.001);
        expect(rect.top).toBeGreaterThanOrEqual(-0.001);
        expect(rect.left + rect.width).toBeLessThanOrEqual(TILE_BOX.w + 0.001);
        expect(rect.top + rect.height).toBeLessThanOrEqual(TILE_BOX.h + 0.001);
    }
});

test("the marker lands on the same sprite pixel whatever shape the tile is", () => {
    // `frameTopLeft` and the marker both come from the same reference, so the marker's offset INTO the
    // frame is the anchor and nothing else. A tile whose reference is NOT its centre is what makes this
    // falsifiable - a sign error in refX/refY would look identical on a centred one.
    const frame = { width: 200, height: 500, offsetX: 100, offsetY: 480 };
    const anchorInFrame = (box: TileBox): { x: number; y: number } => {
        const tl = frameTopLeft({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box);
        const pct = referenceMarkerPercent("bam", frame.height, box);
        return { x: (pct.x / 100) * box.w - tl.x, y: (pct.y / 100) * box.h - tl.y };
    };
    const offCentre = anchorInFrame(TILE_BOX);
    const centred = anchorInFrame({ w: 960, h: 960, refX: 480, refY: 480 });
    expect(offCentre.x).toBeCloseTo(frame.offsetX);
    expect(offCentre.y).toBeCloseTo(frame.offsetY);
    expect(centred.x).toBeCloseTo(offCentre.x);
    expect(centred.y).toBeCloseTo(offCentre.y);
});

test("BAMC uses the same tile-centre anchor as BAM", () => {
    const geom = { width: 10, height: 10, offsetX: 5, offsetY: 5, dirOffsetX: 0, dirOffsetY: 0 } as const;
    expect(frameTopLeft({ sourceFormat: "bamc", ...geom }, SQUARE_96)).toEqual(
        frameTopLeft({ sourceFormat: "bam", ...geom }, SQUARE_96),
    );
});

test("BAM v2 anchors on its stored centre exactly as v1 does", () => {
    // v2's frame entry stores the same centre X/Y as v1, so both must place identically; a v2 file
    // that drifted here would sit visibly off from the same sprite saved as v1.
    const geom = { width: 40, height: 76, offsetX: 20, offsetY: 38, dirOffsetX: 0, dirOffsetY: 0 };

    expect(frameTopLeft({ sourceFormat: "bamv2", ...geom }, SQUARE_96)).toEqual(
        frameTopLeft({ sourceFormat: "bam", ...geom }, SQUARE_96),
    );
    expect(referenceMarkerPercent("bamv2", 76, SQUARE_96)).toEqual(referenceMarkerPercent("bam", 76, SQUARE_96));
});

// The stage fits the CELL GRID to itself and the reader scales the SPRITES inside it, so the two
// scales are independent. These pin the seam between them.
const SPRITE = {
    sourceFormat: "bam" as const,
    width: 40,
    height: 76,
    offsetX: 20,
    offsetY: 38,
    dirOffsetX: 0,
    dirOffsetY: 0,
};

test("one scale for both reproduces the single-zoom placement exactly", () => {
    // The compatibility property: nothing moves while the reader leaves the sprite scale at the fit.
    const box: TileBox = { w: 120, h: 140, refX: 55, refY: 70 };
    for (const z of [0.25, 1, 2.5]) {
        const tl = frameTopLeft(SPRITE, box);
        expect(spriteRect(SPRITE, box, z, z)).toEqual({
            left: tl.x * z,
            top: tl.y * z,
            width: SPRITE.width * z,
            height: SPRITE.height * z,
        });
    }
});

test("scaling the sprite alone pivots on the anchor, so it grows in place", () => {
    // What stops the sprite walking across its cell as the reader zooms: the anchor keeps its spot in
    // the cell and the art expands around it.
    const box: TileBox = { w: 120, h: 140, refX: 55, refY: 70 };
    const anchorOf = (spriteScale: number): { x: number; y: number } => {
        const r = spriteRect(SPRITE, box, 1, spriteScale);
        return { x: r.left + SPRITE.offsetX * spriteScale, y: r.top + SPRITE.offsetY * spriteScale };
    };
    expect(anchorOf(4)).toEqual(anchorOf(1));
    expect(anchorOf(0.25)).toEqual(anchorOf(1));
});

test("the cell scale alone moves the anchor, so a tile keeps its place in the grid", () => {
    const box: TileBox = { w: 120, h: 140, refX: 55, refY: 70 };
    const at = (layoutScale: number): number => spriteRect(SPRITE, box, layoutScale, 1).left + SPRITE.offsetX;
    // The anchor sits at refX * layoutScale - it is the cell's own coordinate, not the sprite's.
    expect(at(1)).toBeCloseTo(55);
    expect(at(2)).toBeCloseTo(110);
});
