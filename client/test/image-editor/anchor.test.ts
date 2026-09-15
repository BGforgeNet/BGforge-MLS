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
import { TILE_BOX_PX } from "../../src/image-editor/webview/render/tile";

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

test("every animation gets the same square tile until the art outgrows it", () => {
    const small = tileBoxPx(oneFrameView({ width: 30, height: 30, offsetX: 15, offsetY: 15 }));
    const large = tileBoxPx(oneFrameView({ width: 190, height: 199, offsetX: 95, offsetY: 99 }));
    expect(small.w).toBe(small.h);
    expect([large.w, large.h]).toEqual([small.w, small.h]);
    // Past the base square the box takes the art's own size at the scale it is drawn, which is what
    // spreads the tiles apart instead of letting a zoomed sprite reach over its neighbours.
    const grown = tileBoxPx(oneFrameView({ width: 600, height: 400, offsetX: 300, offsetY: 399 }), 2);
    expect([grown.w, grown.h]).toEqual([1200, 1200]);
});

test("the anchor lands wherever centring the art puts it, at any scale", () => {
    // The placement rule: the art sits in the middle of the tile, and the ground point goes where that
    // leaves it - so a creature with shadow below its anchor gets the whole tile to grow into rather than
    // the share above a fixed line. Falsified by dropping the scale term: at 2x this then sits 40px high.
    const frame = { width: 40, height: 100, offsetX: 20, offsetY: 90 };
    const view = oneFrameView(frame);
    for (const scale of [1, 2, 5]) {
        const box = tileBoxPx(view, scale);
        const rect = spriteRect({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box, 1, scale);
        expect(rect.top).toBeCloseTo((box.h - frame.height * scale) / 2);
        expect(rect.left).toBeCloseTo((box.w - frame.width * scale) / 2);
    }
});

test("the fill ratio is the tile against the art's longer side", () => {
    // A sprite half as wide as it is tall fills the square's height and keeps its margin across the width.
    const view = oneFrameView({ width: 100, height: 200, offsetX: 50, offsetY: 190 });
    expect(spriteFillRatio(view)).toBeCloseTo(TILE_BOX_PX / 200);
});

test("where the anchor sits inside the art costs the sprite nothing", () => {
    // The same art anchored at its centre and then 300px below itself. Centring the art at the drawn scale
    // takes the anchor out of the size question: both fill the tile equally. Falsified by bounding the
    // fill per anchor edge, which answers a fraction of this for the second.
    const centred = oneFrameView({ width: 40, height: 40, offsetX: 20, offsetY: 20 });
    const offAnchor = oneFrameView({ width: 40, height: 40, offsetX: 20, offsetY: 300 });
    expect(spriteFillRatio(offAnchor)).toBeCloseTo(spriteFillRatio(centred));
});

test("the whole FILE is what fits, not the cycle on screen", () => {
    // The scale is chosen once, when the animation opens, and switching sequence must not resize anything -
    // so a taller cycle nobody is looking at still has to fit. Falsified by measuring one cycle: the answer
    // then doubles and picking the second sequence would push the sprite over its neighbours.
    const view = {
        sourceFormat: "bam" as const,
        frames: [
            { width: 40, height: 100, offsetX: 20, offsetY: 50 },
            { width: 40, height: 200, offsetX: 20, offsetY: 100 },
        ],
        sequences: [
            { frameRefs: [0], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 },
            { frameRefs: [1], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 },
        ],
    };
    expect(spriteFillRatio(view)).toBeCloseTo(TILE_BOX_PX / 200);
});

test("the fill ratio of an animation that draws nothing is 1", () => {
    const view = { sourceFormat: "bam" as const, frames: [], sequences: [] };
    expect(spriteFillRatio(view)).toBe(1);
});

test("at the fill scale every frame of the animation is inside its tile", () => {
    // What the fill ratio promises, stated at the consumer: nothing clips at the scale a view opens on.
    // Two frames reaching opposite ways from one anchor, so a bound taken on either alone lets the other
    // out - and they are in different sequences, which is what the file-wide measurement is for.
    const view = {
        sourceFormat: "bam" as const,
        frames: [
            { width: 40, height: 100, offsetX: 20, offsetY: 99 }, // stands on its anchor
            { width: 60, height: 80, offsetX: 30, offsetY: 10 }, // hangs below it
        ],
        sequences: [
            { frameRefs: [0], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 },
            { frameRefs: [1], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 },
        ],
    };
    const scale = spriteFillRatio(view);
    const box = tileBoxPx(view, scale);
    // The fill scale is exactly the scale that needs no growth - a larger one would round the box up
    // and stop the tiles reading as one size. Without this the containment below cannot fail, since a
    // grown box holds its art at any scale.
    expect(box.w).toBe(TILE_BOX_PX);
    for (const frame of view.frames) {
        const rect = spriteRect({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box, 1, scale);
        expect(rect.left).toBeGreaterThanOrEqual(-0.001);
        expect(rect.top).toBeGreaterThanOrEqual(-0.001);
        expect(rect.left + rect.width).toBeLessThanOrEqual(box.w + 0.001);
        expect(rect.top + rect.height).toBeLessThanOrEqual(box.h + 0.001);
    }
});

test("a frame stays inside its tile at every scale, so no tile can reach into its neighbour", () => {
    // The whole no-overlap guarantee, at the layer that decides it: the rose and the grid both space
    // their cells by the tile, so containment here is what keeps a dragon's sprites off each other at
    // 100%. Falsified by a tile of constant size - at 4x the art overhangs by three times the tile.
    const view = {
        sourceFormat: "bam" as const,
        frames: [
            { width: 620, height: 300, offsetX: 310, offsetY: 299 }, // stands on its anchor
            { width: 400, height: 480, offsetX: 200, offsetY: 40 }, // hangs below it
        ],
        sequences: [
            { frameRefs: [0], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 },
            { frameRefs: [1], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 },
        ],
    };
    for (const ratio of [0.25, 1, 4]) {
        const box = tileBoxPx(view, ratio);
        for (const frame of view.frames) {
            const rect = spriteRect({ sourceFormat: "bam", ...frame, dirOffsetX: 0, dirOffsetY: 0 }, box, 1, ratio);
            expect(rect.left).toBeGreaterThanOrEqual(-0.001);
            expect(rect.top).toBeGreaterThanOrEqual(-0.001);
            expect(rect.left + rect.width).toBeLessThanOrEqual(box.w + 0.001);
            expect(rect.top + rect.height).toBeLessThanOrEqual(box.h + 0.001);
        }
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
    const offCentre = anchorInFrame(tileBoxPx(oneFrameView(frame)));
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
