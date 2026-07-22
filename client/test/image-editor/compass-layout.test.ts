import { expect, test } from "vitest";
import { FRM_FACINGS, type Facing } from "@bgforge/image";
import { compassCell, layoutSequences } from "../../src/image-editor/webview/render/compass-layout";
import type { AnimationView, SequenceView } from "../../src/image-editor/webview/messages";

/** A minimal AnimationView carrying only the fields layoutSequences reads (sequences). */
function makeView(facings: Facing[]): AnimationView {
    const sequences: SequenceView[] = facings.map((facing, i) => ({ frameRefs: [i], facing }));
    return {
        palette: [],
        frames: [],
        sequences,
        meta: { sourceFormat: "frm" },
        basename: "test",
        sourceFormat: "frm",
        hasSidecarPal: false,
        externalPaletteActive: false,
        dirty: false,
    };
}

test("compassCell maps the 8 compass facings to their hex-rose cells", () => {
    expect(compassCell("NW")).toEqual({ row: 0, col: 0 });
    expect(compassCell("N")).toEqual({ row: 0, col: 1 });
    expect(compassCell("NE")).toEqual({ row: 0, col: 2 });
    expect(compassCell("W")).toEqual({ row: 1, col: 0 });
    expect(compassCell("E")).toEqual({ row: 1, col: 2 });
    expect(compassCell("SW")).toEqual({ row: 2, col: 0 });
    expect(compassCell("S")).toEqual({ row: 2, col: 1 });
    expect(compassCell("SE")).toEqual({ row: 2, col: 2 });
});

test("compassCell returns undefined for a non-directional facing", () => {
    expect(compassCell("none")).toBeUndefined();
});

test("layoutSequences maps an FRM's 6 unique compass facings to a compass rose with no N/S tile", () => {
    const view = makeView(FRM_FACINGS);
    const result = layoutSequences(view);
    expect(result.mode).toBe("compass");
    if (result.mode !== "compass") throw new Error("expected compass mode");
    expect(result.tiles).toHaveLength(6);
    const byFacing = new Map(result.tiles.map((tile) => [tile.seq.facing, tile.cell]));
    expect(byFacing.get("NE")).toEqual({ row: 0, col: 2 });
    expect(byFacing.get("E")).toEqual({ row: 1, col: 2 });
    expect(byFacing.get("SE")).toEqual({ row: 2, col: 2 });
    expect(byFacing.get("SW")).toEqual({ row: 2, col: 0 });
    expect(byFacing.get("W")).toEqual({ row: 1, col: 0 });
    expect(byFacing.get("NW")).toEqual({ row: 0, col: 0 });
    expect(byFacing.has("N")).toBe(false);
    expect(byFacing.has("S")).toBe(false);
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
    const byFacing = new Map(result.tiles.map((tile) => [tile.seq.facing, tile.cell]));
    expect(byFacing.get("N")).toEqual({ row: 0, col: 1 });
    expect(byFacing.get("S")).toEqual({ row: 2, col: 1 });
});

test("layoutSequences falls back to a grid when facings duplicate, even though all are compass facings", () => {
    const view = makeView(["N", "N"]);
    const result = layoutSequences(view);
    expect(result.mode).toBe("grid");
    if (result.mode !== "grid") throw new Error("expected grid mode");
    expect(result.tiles.map((tile) => tile.index)).toEqual([0, 1]);
});
