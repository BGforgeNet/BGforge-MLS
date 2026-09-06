import { expect, test } from "vitest";
import { FRM_FACINGS, type Facing } from "@bgforge/image";
import { type IeDirectionAnalysis, interpretIeDirections } from "@bgforge/image/ie-direction";
import {
    compassPosition,
    defaultLayoutMode,
    directionBlocks,
    firstDrawnBlock,
    ieRoseTiles,
    layoutSequences,
    roseGeometry,
} from "../../src/image-editor/webview/render/compass-layout";
import type { AnimationView, SequenceView } from "../../src/image-editor/webview/messages";

/** A minimal AnimationView carrying only the fields layoutSequences reads (sequences). */
function makeView(facings: Facing[]): AnimationView {
    const sequences: SequenceView[] = facings.map((facing, i) => ({
        frameRefs: [i],
        facing,
        dirOffsetX: 0,
        dirOffsetY: 0,
    }));
    return {
        colorModel: "indexed",
        palette: [],
        frames: [],
        pixels: new ArrayBuffer(0),
        sequences,
        meta: { sourceFormat: "frm" },
        basename: "test",
        sourceFormat: "frm",
        hasSidecarPal: false,
        externalPaletteActive: false,
    };
}

test("compassPosition places the cardinals on the unit circle (y down: N is up, S is down)", () => {
    const p = (f: Parameters<typeof compassPosition>[0]) => compassPosition(f);
    expect(p("E")).toEqual({ dx: expect.closeTo(1), dy: expect.closeTo(0) });
    expect(p("W")).toEqual({ dx: expect.closeTo(-1), dy: expect.closeTo(0) });
    expect(p("N")).toEqual({ dx: expect.closeTo(0), dy: expect.closeTo(-1) }); // up
    expect(p("S")).toEqual({ dx: expect.closeTo(0), dy: expect.closeTo(1) }); // down
});

test("compassPosition places the half-step facings at their own 22.5-degree angles", () => {
    // SSW is one step counter-clockwise from S on the 16-point wheel: below centre, slightly left.
    const ssw = compassPosition("SSW");
    expect(ssw?.dx).toBeCloseTo(-Math.cos((67.5 * Math.PI) / 180));
    expect(ssw?.dy).toBeCloseTo(Math.sin((67.5 * Math.PI) / 180));
    // The eight half-steps sit strictly between their neighbouring 45-degree points, and no two coincide.
    const wheel: Facing[] = [
        "S",
        "SSW",
        "SW",
        "WSW",
        "W",
        "WNW",
        "NW",
        "NNW",
        "N",
        "NNE",
        "NE",
        "ENE",
        "E",
        "ESE",
        "SE",
        "SSE",
    ];
    const angles = wheel.map((f) => {
        const p = compassPosition(f);
        return p ? Math.round(Math.atan2(-p.dy, p.dx) * (180 / Math.PI) * 10) / 10 : undefined;
    });
    expect(new Set(angles).size).toBe(16);
    expect(angles).not.toContain(undefined);
});

test("roseGeometry widens the circle when the facings are closer together", () => {
    const at = (facings: Facing[]) =>
        facings.flatMap((f) => (compassPosition(f) ? [{ pos: compassPosition(f)! }] : []));
    const octagon = roseGeometry(at(["S", "SW", "W", "NW", "N", "NE", "E", "SE"]));
    const westArc = roseGeometry(at(["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N"]));
    // 45 degrees apart keeps the established radius; 22.5 degrees needs a bigger circle or the tiles
    // overlap - the chord between neighbours must stay at least one tile wide.
    expect(octagon.radiusTiles).toBeCloseTo(1.5);
    expect(westArc.radiusTiles).toBeGreaterThan(2.5);
    const chord = 2 * westArc.radiusTiles * Math.sin(Math.PI / 16);
    expect(chord).toBeGreaterThanOrEqual(1);
});

test("roseGeometry fits the box to the tiles present, so a half-populated rose is not half dead space", () => {
    const at = (facings: Facing[]) =>
        facings.flatMap((f) => (compassPosition(f) ? [{ pos: compassPosition(f)! }] : []));
    const westArc = roseGeometry(at(["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N"]));
    // The arc spans the full height of its circle but only one side of it, so the box is taller than wide.
    expect(westArc.heightTiles).toBeGreaterThan(westArc.widthTiles * 1.5);
    // Every tile lands inside the box it reports.
    for (const c of westArc.centers) {
        expect(c.x).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(c.x).toBeLessThanOrEqual(westArc.widthTiles - 0.5 + 1e-9);
        expect(c.y).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(c.y).toBeLessThanOrEqual(westArc.heightTiles - 0.5 + 1e-9);
    }
});

test("compassPosition pulls the diagonals in to +/-0.707 so E/W bulge out past them - a rose, not columns", () => {
    const ne = compassPosition("NE");
    expect(ne?.dx).toBeCloseTo(Math.SQRT1_2); // cos 45deg
    expect(ne?.dy).toBeCloseTo(-Math.SQRT1_2); // up and to the right
    // NE's horizontal offset is strictly less than E's, so it does not stack into a straight column.
    expect(Math.abs(ne?.dx ?? 1)).toBeLessThan(Math.abs(compassPosition("E")?.dx ?? 0));
});

test("compassPosition returns undefined for a non-directional facing", () => {
    expect(compassPosition("none")).toBeUndefined();
});

test("layoutSequences maps an FRM's 6 unique compass facings to a rose with no N/S tile", () => {
    const view = makeView(FRM_FACINGS);
    const result = layoutSequences(view);
    expect(result.mode).toBe("compass");
    if (result.mode !== "compass") throw new Error("expected compass mode");
    expect(result.tiles).toHaveLength(6);
    const byFacing = new Map(result.tiles.map((tile) => [tile.seq.facing, tile.pos]));
    expect(new Set(byFacing.keys())).toEqual(new Set(FRM_FACINGS));
    expect(byFacing.has("N")).toBe(false);
    expect(byFacing.has("S")).toBe(false);
    // The 6 positions are distinct points on the circle (no two facings collapse onto one spot).
    const spots = new Set([...byFacing.values()].map((p) => `${p.dx.toFixed(3)},${p.dy.toFixed(3)}`));
    expect(spots.size).toBe(6);
});

test("layoutSequences collapses a single-orientation FRM (all rotations share frames) to one grid cell", () => {
    // The shared-data-offset form: 6 FRM facings, every rotation referencing the SAME frame.
    const view = makeView(FRM_FACINGS);
    view.sequences = view.sequences.map((seq) => ({ ...seq, frameRefs: [0] }));
    const result = layoutSequences(view);
    expect(result.mode).toBe("grid");
    if (result.mode !== "grid") throw new Error("expected grid mode");
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]?.seq.frameRefs).toEqual([0]);
});

test("layoutSequences falls back to a grid for a non-directional BAM, one tile per cycle in order", () => {
    const view = makeView(["none", "none", "none"]);
    const result = layoutSequences(view);
    expect(result.mode).toBe("grid");
    if (result.mode !== "grid") throw new Error("expected grid mode");
    expect(result.tiles.map((tile) => tile.index)).toEqual([0, 1, 2]);
    expect(result.tiles.map((tile) => tile.seq.facing)).toEqual(["none", "none", "none"]);
});

test("layoutSequences maps an 8-facing BAM to a full compass rose including N and S", () => {
    const eightFacings: Facing[] = ["NW", "N", "NE", "W", "E", "SW", "S", "SE"];
    const view = makeView(eightFacings);
    const result = layoutSequences(view);
    expect(result.mode).toBe("compass");
    if (result.mode !== "compass") throw new Error("expected compass mode");
    expect(result.tiles).toHaveLength(8);
    const byFacing = new Map(result.tiles.map((tile) => [tile.seq.facing, tile.pos]));
    // The 8-facing rose fills N (straight up) and S (straight down), unlike the 6-facing FRM rose.
    expect(byFacing.get("N")).toEqual({ dx: expect.closeTo(0), dy: expect.closeTo(-1) });
    expect(byFacing.get("S")).toEqual({ dx: expect.closeTo(0), dy: expect.closeTo(1) });
});

test("layoutSequences falls back to a grid when facings duplicate, even though all are compass facings", () => {
    const view = makeView(["N", "N"]);
    const result = layoutSequences(view);
    expect(result.mode).toBe("grid");
    if (result.mode !== "grid") throw new Error("expected grid mode");
    expect(result.tiles.map((tile) => tile.index)).toEqual([0, 1]);
});

test("compass tiles carry the display facing (identical to the sequence's own tag for tagged views)", () => {
    const result = layoutSequences(makeView(FRM_FACINGS));
    if (result.mode !== "compass") throw new Error("expected compass mode");
    expect(result.tiles.map((tile) => tile.facing)).toEqual(result.tiles.map((tile) => tile.seq.facing));
});

/**
 * The reading a declared band width settles and inference cannot: a sixteen-cycle band divides evenly into
 * two eight-slot blocks and each half is uniform, so a file of one wide band reads as two narrow ones -
 * twice the stances, half the facings, and each facing drawn twice.
 */
test("directionBlocks reads a wide band at its declared width rather than inferring two narrow ones", () => {
    const view = makeView(Array.from({ length: 16 }, () => "none" as const));
    view.frames = Array.from({ length: 17 }, () => ({ width: 30, height: 40, offsetX: 0, offsetY: 0 }));
    view.sequences = view.sequences.map((sequence, i) => ({ ...sequence, frameRefs: [1 + i] }));

    const inferred = directionBlocks(view);
    expect(inferred?.groups).toHaveLength(2);
    expect(inferred?.scheme).toBe("ie8");

    const declared = directionBlocks(view, { stride: 16 });
    expect(declared?.groups).toHaveLength(1);
    expect(declared?.groups[0]).toHaveLength(16);
    // A sixteen-wide band matches no block scheme, so the block-name table has nothing to key on.
    expect(declared?.scheme).toBeUndefined();
});

// A wide-band animation packs its whole walk into ONE band, so the block-count proxy for "these cycles
// are facings" says grid where the declaration says rose.
test("defaultLayoutMode opens a single DECLARED band on the rose, and a single inferred one on the grid", () => {
    const view = makeView(Array.from({ length: 16 }, () => "none" as const));
    view.frames = Array.from({ length: 17 }, () => ({ width: 30, height: 40, offsetX: 0, offsetY: 0 }));
    view.sequences = view.sequences.map((sequence, i) => ({ ...sequence, frameRefs: [1 + i] }));

    expect(defaultLayoutMode(null, directionBlocks(view, { stride: 16 }))).toBe("rose");
    expect(defaultLayoutMode(null, { groups: [[{ seqIndex: 0, facing: "S" }]] })).toBe("grid");
});

test("directionBlocks refuses a declared width no IE scheme stores, rather than falling back to a guess", () => {
    expect(directionBlocks(makeView(Array.from({ length: 16 }, () => "none" as const)), { stride: 7 })).toBeUndefined();
});

test("ieRoseTiles builds one direction block's rose from untagged cycles, at the IE slot facings", () => {
    // Two stride-8 blocks: west slots real, east slots one shared filler (frame 0).
    const view = makeView(Array.from({ length: 16 }, () => "none" as const));
    view.sequences = view.sequences.map((sequence, i) => ({
        ...sequence,
        frameRefs: i % 8 < 5 ? [1 + i] : [0],
    }));
    const interpretation = interpretIeDirections(view.sequences, 17);
    if (!interpretation) throw new Error("expected an IE interpretation");
    expect(interpretation.detected).toBe(true);

    const block0 = ieRoseTiles(view, interpretation, 0);
    expect(block0.map((tile) => tile.facing)).toEqual(["S", "SW", "W", "NW", "N"]);
    // The display facing comes from the slot position - the sequences themselves stay untagged.
    expect(block0.every((tile) => tile.seq.facing === "none")).toBe(true);
    // Every tile lands on a distinct compass position (the rose relies on facing uniqueness per block).
    const spots = new Set(block0.map((tile) => `${tile.pos.dx.toFixed(3)},${tile.pos.dy.toFixed(3)}`));
    expect(spots.size).toBe(5);

    const block1 = ieRoseTiles(view, interpretation, 1);
    expect(block1.map((tile) => tile.seq.frameRefs[0])).toEqual([9, 10, 11, 12, 13]);
    expect(ieRoseTiles(view, interpretation, 99)).toEqual([]);
});

/**
 * A coarse-path band stores each picture in a pair of neighbouring slots, so its sixteen slots carry eight
 * facings. A rose is one tile per compass point: a second tile of the same facing lands at the same angle,
 * hidden under the first, and the keyed list the rose renders from cannot hold two of one key at all.
 */
test("ieRoseTiles gives a coarse-path band one tile per facing, not one per slot", () => {
    const view = makeView(Array.from({ length: 16 }, () => "none" as const));
    // Real frames: the declared band cut drops any slot whose refs fall outside the frame table.
    view.frames = Array.from({ length: 17 }, () => ({ width: 30, height: 40, offsetX: 0, offsetY: 0 }));
    view.sequences = view.sequences.map((sequence, i) => ({ ...sequence, frameRefs: [1 + i] }));
    const blocks = directionBlocks(view, { stride: 16, coarse: true });
    if (!blocks) throw new Error("expected declared blocks");

    const tiles = ieRoseTiles(view, blocks, 0);

    expect(tiles.map((tile) => tile.facing)).toEqual(["S", "SW", "W", "NW", "N", "NE", "E", "SE"]);
    expect(new Set(tiles.map((tile) => tile.facing)).size).toBe(tiles.length);
    // The tile kept is the first slot of each pair, so the rose draws the same art the grid opens on.
    expect(tiles.map((tile) => tile.seq.frameRefs[0])).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
});

/**
 * A packed file's skeleton: sixteen cycles in two stride-8 blocks, where the first block references only
 * the 1x1 placeholder every undrawn band of a character file is padded with, and the second holds sprites.
 */
function skeletonView(): { view: AnimationView; interpretation: IeDirectionAnalysis } {
    const view = makeView(Array.from({ length: 16 }, () => "none" as const));
    view.frames = [
        { width: 1, height: 1, offsetX: 0, offsetY: 0 },
        { width: 30, height: 40, offsetX: 0, offsetY: 0 },
    ];
    view.sequences = view.sequences.map((sequence, i) => ({ ...sequence, frameRefs: i < 8 ? [0] : [1] }));
    const interpretation = interpretIeDirections(view.sequences, view.frames.length);
    if (!interpretation) throw new Error("expected an IE interpretation");
    return { view, interpretation };
}

test("firstDrawnBlock skips the placeholder blocks a packed file pads its skeleton with", () => {
    const { view, interpretation } = skeletonView();
    expect(firstDrawnBlock(view, interpretation)).toBe(1);
});

// The burrowing scheme's `G1` opens on a block it addresses no sequence to. That block's padding is a
// frame per facing at the sprite's own size rather than a single pixel, so it passes the does-this-draw
// test and would otherwise be what a reader lands on: a full-size stage of transparent tiles.
test("firstDrawnBlock skips a block the scheme addresses no sequence to", () => {
    const { view, interpretation } = skeletonView();
    // Both blocks hold real sprites, so only the declaration can rule the first one out.
    view.sequences = view.sequences.map((sequence) => ({ ...sequence, frameRefs: [1] }));

    expect(firstDrawnBlock(view, interpretation)).toBe(0);
    expect(firstDrawnBlock(view, interpretation, [{ label: "(unused)", unused: true }, { label: "WK - walk" }])).toBe(
        1,
    );
});

test("firstDrawnBlock opens on the first block where nothing in the file draws", () => {
    const { view, interpretation } = skeletonView();
    // Every cycle on the placeholder: there is no better block to offer than the first.
    view.sequences = view.sequences.map((sequence) => ({ ...sequence, frameRefs: [0] }));
    expect(firstDrawnBlock(view, interpretation)).toBe(0);
});
