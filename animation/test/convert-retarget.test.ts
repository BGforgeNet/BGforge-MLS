import { describe, expect, it } from "vitest";
import { type Facing, type IndexedAnimation, isRgbaAnimation, loadImage, serializeBamV1 } from "@bgforge/image";
import { type NeutralAction } from "../src/neutral/model";
import { IE_16_POINT_FULL, IE_8_POINT_MIRRORED, IE_8_POINT_PAIRED } from "../src/convert/target";
import { retargetAction } from "../src/convert/retarget";
import { greyPalette } from "../../image/test/bam-fixtures.ts";

/**
 * One cycle per facing, each drawing a frame that is NOT left-right symmetric.
 *
 * Asymmetry is the point: a mirrored cycle that reused the source frame unflipped would be invisible in
 * any assertion over a uniformly filled fixture, which is what the shared BAM fixtures build.
 */
function bandOf(facings: Facing[]): IndexedAnimation {
    const palette = greyPalette();
    for (let i = 1; i < 32; i++) palette[i] = { r: i * 8, g: 255 - i * 8, b: 0, a: 255 };
    // 2x1: left pixel carries the cycle's own index, right pixel is always 1. A flip swaps them.
    const frames = facings.map((_, at) => ({
        width: 2,
        height: 1,
        pixels: new Uint8Array([at + 2, 1]),
        offsetX: 0,
        offsetY: 0,
    }));
    const animation: IndexedAnimation = {
        palette,
        frames,
        sequences: facings.map((facing, at) => ({ frameRefs: [at], facing })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    // Through the real codec, so what the retargeter sees is a parsed animation rather than a literal.
    const parsed = loadImage(serializeBamV1(animation), "BAND.BAM");
    if (isRgbaAnimation(parsed)) throw new Error("a BAM v1 fixture parsed as true colour");
    return parsed;
}

/** The action that reads `bandOf`'s cycles in order. */
function actionOver(facings: Facing[]): NeutralAction {
    return {
        label: "WK - walk",
        resrefs: ["BAND"],
        band: 0,
        cycles: {
            kind: "directional",
            directions: facings.map((facing, at) => ({ facing, sequenceIndex: at })),
        },
    };
}

const WEST_ARC_8: Facing[] = ["S", "SW", "W", "NW", "N"];
const ALL_8: Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

/** The pixels of a retargeted facing's first frame. */
function pixelsFor(result: ReturnType<typeof retargetAction>, facing: Facing): number[] {
    const at = result.facings.indexOf(facing);
    if (at === -1) throw new Error(`no ${facing} in [${result.facings.join(", ")}]`);
    const ref = result.animation.sequences[at]?.frameRefs[0];
    if (ref === undefined) throw new Error(`${facing} has no frame`);
    return [...(result.animation.frames[ref]?.pixels ?? [])];
}

describe("retargeting an action's directions", () => {
    it("passes the stored arc through untouched when the target stores exactly it", () => {
        const result = retargetAction(bandOf(WEST_ARC_8), actionOver(WEST_ARC_8), IE_8_POINT_MIRRORED);

        expect(result.facings).toEqual(WEST_ARC_8);
        // Nothing was mirrored, so the frame pool is the source's own.
        expect(result.animation.frames).toHaveLength(5);
    });

    /**
     * The target stores what the source only mirrors, so the eastern art is GENERATED - engine-faithful
     * data the source never held, which is why this direction of the conversion loses nothing.
     */
    it("generates the eastern facings a storing target wants, flipped from their western partners", () => {
        const result = retargetAction(bandOf(WEST_ARC_8), actionOver(WEST_ARC_8), IE_8_POINT_PAIRED);

        expect(result.facings).toEqual(ALL_8);
        // W is cycle 2, so its frame is [4, 1]; E is its mirror and must read back flipped.
        expect(pixelsFor(result, "W")).toEqual([4, 1]);
        expect(pixelsFor(result, "E")).toEqual([1, 4]);
    });

    /** A mirrored frame is built once and shared, or a set's every band re-adds the same flipped art. */
    it("builds each mirrored frame once, however many facings read it", () => {
        const facings: Facing[] = ["W", "NW"];
        const source = bandOf(facings);
        // Both cycles drawing frame 0 means both eastern partners mirror the SAME source frame.
        source.sequences = source.sequences.map((seq) => ({ ...seq, frameRefs: [0] }));

        const result = retargetAction(source, actionOver(facings), IE_8_POINT_PAIRED);

        // Two source frames plus exactly one mirror, not one per eastern facing.
        expect(result.animation.frames).toHaveLength(3);
    });

    /**
     * Section 4.2's fourth row on the data side: the target stores only the western arc, so the source's
     * drawn eastern cycles are dropped rather than folded in. The planner is what reports it as a loss.
     */
    it("drops the source's drawn eastern art when the target stores only the west", () => {
        const result = retargetAction(bandOf(ALL_8), actionOver(ALL_8), IE_8_POINT_MIRRORED);

        expect(result.facings).toEqual(WEST_ARC_8);
        expect(pixelsFor(result, "S")).toEqual([2, 1]);
    });

    /**
     * Most of what an install ships is non-directional - `bare` and `cycles` sections - and its cycles are
     * an ordered list, not a direction map. Rebuilding one in a direction order would produce whatever
     * facings the target happens to store, which for these is none at all.
     */
    it("passes a non-directional member straight through", () => {
        const source = bandOf(["S", "W"]);
        const ordered: NeutralAction = {
            label: "G1",
            resrefs: ["BAND"],
            band: 0,
            cycles: { kind: "ordered", sequenceIndices: [0, 1] },
        };

        const result = retargetAction(source, ordered, IE_8_POINT_PAIRED);

        expect(result.animation).toBe(source);
        expect(result.animation.sequences).toHaveLength(2);
    });

    /**
     * A ref past the frame table is the "no frame" sentinel some files carry, and the reading already
     * ignores it. Mirroring must carry it through rather than inventing a frame at that index, which would
     * put arbitrary art where the source deliberately had none.
     */
    it("carries a no-frame sentinel through a mirror instead of inventing art for it", () => {
        const source = bandOf(["W"]);
        source.sequences = [{ frameRefs: [0, 99], facing: "W" }];

        const result = retargetAction(source, actionOver(["W"]), IE_8_POINT_PAIRED);

        const east = result.animation.sequences[result.facings.indexOf("E")];
        expect(east?.frameRefs[1]).toBe(99);
        // One real frame mirrored, and nothing conjured for the sentinel.
        expect(result.animation.frames).toHaveLength(2);
    });

    /**
     * An action whose slot addresses a cycle the animation does not have - a member whose file was replaced
     * by a shorter one - is skipped rather than crashing the whole set's conversion.
     */
    it("skips a slot addressing a cycle the animation does not have", () => {
        const source = bandOf(["S", "W"]);
        const action: NeutralAction = {
            label: "WK - walk",
            resrefs: ["BAND"],
            band: 0,
            cycles: {
                kind: "directional",
                directions: [
                    { facing: "S", sequenceIndex: 0 },
                    { facing: "W", sequenceIndex: 9 },
                ],
            },
        };

        expect(retargetAction(source, action, IE_8_POINT_MIRRORED).facings).toEqual(["S"]);
    });

    /**
     * A facing the source neither stores nor has a mirror partner for is skipped, not padded with a blank:
     * a blank cycle is art the target would draw, and drawing nothing is worse than showing the engine's
     * own mirror of a neighbouring facing.
     */
    it("skips a target facing the source can supply no art for", () => {
        const result = retargetAction(bandOf(["S", "W"]), actionOver(["S", "W"]), IE_16_POINT_FULL);

        expect(result.facings).toEqual(["S", "W", "E"]);
    });
});
