import { expect, test } from "vitest";
import { FRM_FACINGS, type Facing } from "@bgforge/image";
import { interpretIeDirections } from "@bgforge/image/ie-direction";
import { compassPosition, ieRoseTiles, layoutSequences } from "../../src/image-editor/webview/render/compass-layout";
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
        palette: [],
        frames: [],
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
