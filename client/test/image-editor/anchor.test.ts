import { expect, test } from "vitest";
import { type IndexedAnimation, convertToFrm, emptyPalette } from "@bgforge/image";
import {
    frameTopLeft,
    referenceMarkerPercent,
    spriteFillRatio,
    spriteRect,
    tileBoxPx,
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

test("tileBoxPx keeps the 96px floor for small sprites and ignores unreferenced frames", () => {
    const small = { width: 30, height: 30, offsetX: 15, offsetY: 15 };
    const huge = { width: 400, height: 400, offsetX: 200, offsetY: 200 };
    const view = {
        sourceFormat: "bam" as const,
        frames: [small, huge],
        sequences: [{ frameRefs: [0], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 }],
    };
    // huge is in the pool but no sequence shows it; the 30x30 sprite is padded up to the floor evenly,
    // which leaves its anchor at the centre exactly as the square tile did.
    expect(tileBoxPx(view)).toEqual({ w: 96, h: 96, refX: 48, refY: 48 });
});

test("tileBoxPx stretches the tile to contain an oversized anchored frame", () => {
    // elderbf3-shaped: one 190x199 centre-anchored frame. It needs exactly its own size, where a square
    // tile had to take the larger side in both directions (200x200).
    expect(tileBoxPx(oneFrameView({ width: 190, height: 199, offsetX: 95, offsetY: 99 }))).toEqual({
        w: 190,
        h: 199,
        refX: 95,
        refY: 99,
    });
});

test("tileBoxPx sizes each side independently, so an off-centre anchor costs only its own axis", () => {
    // Feet-ish anchored 30x60 BAM frame (anchor y=53): 53px of the frame hangs above the anchor and 7
    // below. A square tile centred on the anchor had to be 106 to reach the far side; sized per axis the
    // frame needs 60, so both sides fall back to the floor - and the anchor sits low in the tile, where
    // the sprite actually puts it.
    expect(tileBoxPx(oneFrameView({ width: 30, height: 60, offsetX: 15, offsetY: 53 }))).toEqual({
        w: 96,
        h: 96,
        refX: 48,
        refY: 71,
    });
});

test("the fill ratio grows a small sprite until its art meets the floored cell's edges", () => {
    // A 40x40 centre-anchored frame gets the 96px floor, so 56px of its cell is padding. 2.4x is where
    // the art reaches 96 - the scale the Fill button hands the reader.
    const view = oneFrameView({ width: 40, height: 40, offsetX: 20, offsetY: 20 });
    expect(spriteFillRatio(view, tileBoxPx(view))).toBeCloseTo(2.4);
});

test("the fill ratio is bounded by the ANCHOR's own room, not by the art-to-cell ratio", () => {
    // The same 40x40 art in the same 96x96 cell, but anchored 300px below itself. The art is drawn at
    // reference - anchor*scale, so it walks UP the cell as the sprite grows and leaves through the top
    // at 328/300 - long before the 2.4x the art-to-cell ratio alone would allow. Falsified by measuring
    // art against cell (the case above then still passes, this one answers 2.4).
    const view = oneFrameView({ width: 40, height: 40, offsetX: 20, offsetY: 300 });
    expect(spriteFillRatio(view, tileBoxPx(view))).toBeCloseTo(328 / 300);
});

test("a tile already sized to its own art cannot be filled any further", () => {
    // The dragon: the box IS the art's bounding box, so 1:1 is both the fit and the fill.
    const view = oneFrameView({ width: 200, height: 500, offsetX: 100, offsetY: 480 });
    expect(spriteFillRatio(view, tileBoxPx(view))).toBeCloseTo(1);
});

test("the fill ratio of an animation that draws nothing is 1", () => {
    const view = { sourceFormat: "bam" as const, frames: [], sequences: [] };
    expect(spriteFillRatio(view, tileBoxPx(view))).toBe(1);
});

test("tileBoxPx does not stretch to reach an anchor the art never gets near", () => {
    // A rat-shaped case: a 40x40 sprite whose ground point sits 300px below it, so the art occupies a
    // band nowhere near the anchor. Spanning to the anchor made the tile 300 tall to hold 40 of art, and
    // every layout pays that per tile - the rose spaces by the tile, so the wheel grew with the gap.
    const box = tileBoxPx(oneFrameView({ width: 40, height: 40, offsetX: 20, offsetY: 300 }));
    expect(box).toEqual({ w: 96, h: 96, refX: 48, refY: 328 });
    // The reference is now a coordinate, not a point inside the box: it is BELOW the tile here, which is
    // where the sprite's own data puts it.
    expect(box.refY).toBeGreaterThan(box.h);
});

test("a frame whose anchor is outside the box is still drawn wholly inside it", () => {
    // The property that has to survive dropping the anchor from the extents: the ART is what the box
    // holds. Falsified by seeding the extents with the reference again - the box grows and this passes
    // trivially - so it is paired with the size assertion above.
    const frame = { width: 40, height: 40, offsetX: 20, offsetY: 300 };
    const box = tileBoxPx(oneFrameView(frame));
    const tl = frameTopLeft({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(tl.x + frame.width).toBeLessThanOrEqual(box.w);
    expect(tl.y + frame.height).toBeLessThanOrEqual(box.h);
});

test("tileBoxPx holds art that sits entirely to one side of its anchor", () => {
    // The dragon shape: a 200x500 sprite whose ground point is 480px below its own top-left, so the art
    // is almost entirely ABOVE the anchor. The square tile had to be 2x480 in BOTH directions; the box
    // spans the art and no more.
    const box = tileBoxPx(oneFrameView({ width: 200, height: 500, offsetX: 100, offsetY: 480 }));
    expect(box).toEqual({ w: 200, h: 500, refX: 100, refY: 480 });
    // Here the anchor lands inside because the art surrounds it - a property of this sprite, not a
    // guarantee the box makes; the sibling case above has its reference below the tile.
    expect(box.refY).toBeLessThanOrEqual(box.h);
});

test("a frame is drawn fully inside the box its own animation sized", () => {
    // The property the box exists for, stated directly: whatever the anchor does, the art fits.
    const frame = { width: 200, height: 500, offsetX: 100, offsetY: 480 };
    const box = tileBoxPx(oneFrameView(frame));
    const tl = frameTopLeft({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(tl.x + frame.width).toBeLessThanOrEqual(box.w);
    expect(tl.y + frame.height).toBeLessThanOrEqual(box.h);
});

test("the marker lands on the same sprite pixel whatever shape the tile is", () => {
    // The invariant the box has to preserve: `frameTopLeft` and the marker both come from the same
    // reference, so the marker's offset INTO the frame is the anchor and nothing else. An asymmetric box
    // is what makes this falsifiable - under the old square tile every reference was the centre, so a
    // sign error in refX/refY would have looked identical.
    const frame = { width: 200, height: 500, offsetX: 100, offsetY: 480 };
    const anchorInFrame = (box: TileBox): { x: number; y: number } => {
        const tl = frameTopLeft({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box);
        const pct = referenceMarkerPercent("bam", frame.height, box);
        return { x: (pct.x / 100) * box.w - tl.x, y: (pct.y / 100) * box.h - tl.y };
    };
    const tight = anchorInFrame(tileBoxPx(oneFrameView(frame)));
    const square = anchorInFrame({ w: 960, h: 960, refX: 480, refY: 480 });
    expect(tight.x).toBeCloseTo(frame.offsetX);
    expect(tight.y).toBeCloseTo(frame.offsetY);
    expect(square.x).toBeCloseTo(tight.x);
    expect(square.y).toBeCloseTo(tight.y);
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
