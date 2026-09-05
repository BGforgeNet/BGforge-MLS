import { describe, expect, test } from "vitest";
import type { Frame, IndexedAnimation, Rgba } from "../src/model/animation.ts";
import { composeQuadrants } from "../src/model/quadrants.ts";

function palette(): Rgba[] {
    return Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
}

/** A solid `fill` rectangle whose anchor sits at (offsetX, offsetY) from its top-left corner. */
function frame(width: number, height: number, offsetX: number, offsetY: number, fill: number): Frame {
    return { width, height, pixels: new Uint8Array(width * height).fill(fill), offsetX, offsetY };
}

function animation(frames: Frame[], cycles: number[][]): IndexedAnimation {
    return {
        palette: palette(),
        frames,
        sequences: cycles.map((frameRefs) => ({ frameRefs, facing: "none" as const })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}

/** The 2x2 tiling real quadrant files use: parts meet at the anchor's column and 40px above its row. */
function quadrantParts(): IndexedAnimation[] {
    return [
        animation([frame(4, 2, 4, 4, 11)], [[0]]), // top-left:  x -4..0, y -4..-2
        animation([frame(3, 2, 0, 4, 22)], [[0]]), // top-right: x  0..3, y -4..-2
        animation([frame(4, 3, 4, 2, 33)], [[0]]), // bottom-left:  x -4..0, y -2..1
        animation([frame(3, 3, 0, 2, 44)], [[0]]), // bottom-right: x  0..3, y -2..1
    ];
}

describe("composeQuadrants", () => {
    test("unions the parts into one frame that keeps the shared anchor", () => {
        const composed = composeQuadrants(quadrantParts());
        const first = composed?.frames[0];
        // x spans -4..3 and y spans -4..1, so 7x5 with the anchor 4 in and 4 down.
        expect(first?.width).toBe(7);
        expect(first?.height).toBe(5);
        expect(first?.offsetX).toBe(4);
        expect(first?.offsetY).toBe(4);
    });

    test("places each part in its own quarter", () => {
        const composed = composeQuadrants(quadrantParts());
        const f = composed!.frames[0]!;
        const at = (x: number, y: number): number => f.pixels[y * f.width + x]!;
        expect(at(0, 0)).toBe(11); // top-left part
        expect(at(6, 0)).toBe(22); // top-right
        expect(at(0, 4)).toBe(33); // bottom-left
        expect(at(6, 4)).toBe(44); // bottom-right
    });

    test("keeps the cycle structure the parts share", () => {
        const parts = [
            animation([frame(2, 2, 2, 2, 1), frame(2, 2, 2, 2, 2)], [[0, 1], [1]]),
            animation([frame(2, 2, 0, 2, 3), frame(2, 2, 0, 2, 4)], [[0, 1], [1]]),
        ];
        const composed = composeQuadrants(parts);
        expect(composed?.sequences).toHaveLength(2);
        expect(composed?.sequences[0]?.frameRefs).toHaveLength(2);
        expect(composed?.sequences[1]?.frameRefs).toHaveLength(1);
    });

    test("composes one frame per distinct combination, not one per cycle position", () => {
        // Both cycles play the same pair, so the composed animation holds two frames, not four.
        const parts = [
            animation(
                [frame(2, 2, 2, 2, 1), frame(2, 2, 2, 2, 2)],
                [
                    [0, 1],
                    [0, 1],
                ],
            ),
            animation(
                [frame(2, 2, 0, 2, 3), frame(2, 2, 0, 2, 4)],
                [
                    [0, 1],
                    [0, 1],
                ],
            ),
        ];
        expect(composeQuadrants(parts)?.frames).toHaveLength(2);
    });

    test("does not let one part's transparent pixels erase another's image", () => {
        // Overlapping rectangles: the second part is transparent where the first has content.
        const parts = [
            animation([frame(2, 1, 2, 1, 7)], [[0]]),
            animation([{ ...frame(2, 1, 2, 1, 0), pixels: new Uint8Array([0, 0]) }], [[0]]),
        ];
        const f = composeQuadrants(parts)!.frames[0]!;
        expect([...f.pixels]).toEqual([7, 7]);
    });

    test("carries the parts' shared palette and transparent index", () => {
        const composed = composeQuadrants(quadrantParts());
        expect(composed?.palette).toHaveLength(256);
        expect(composed?.meta.transparentIndex).toBe(0);
        expect(composed?.meta.sourceFormat).toBe("bam");
    });

    test("a lone part composes to an animation of the same shape", () => {
        const composed = composeQuadrants([animation([frame(3, 2, 1, 1, 5)], [[0]])]);
        expect(composed?.frames[0]?.width).toBe(3);
        expect(composed?.frames[0]?.offsetX).toBe(1);
        expect(composed?.sequences[0]?.frameRefs).toEqual([0]);
    });

    test("refuses parts whose cycles do not line up, rather than drawing a mismatch", () => {
        const parts = [animation([frame(2, 2, 2, 2, 1)], [[0]]), animation([frame(2, 2, 0, 2, 2)], [[0], [0]])];
        expect(composeQuadrants(parts)).toBeUndefined();
    });

    test("refuses a cycle whose parts hold different frame counts", () => {
        const parts = [
            animation([frame(2, 2, 2, 2, 1), frame(2, 2, 2, 2, 2)], [[0, 1]]),
            animation([frame(2, 2, 0, 2, 3)], [[0]]),
        ];
        expect(composeQuadrants(parts)).toBeUndefined();
    });

    test("refuses an empty part list", () => {
        expect(composeQuadrants([])).toBeUndefined();
    });

    test("skips a zero-area part rather than letting it grow the bounding box", () => {
        const parts = [
            animation([frame(2, 2, 2, 2, 9)], [[0]]),
            animation([{ width: 0, height: 0, pixels: new Uint8Array(), offsetX: 40, offsetY: 40 }], [[0]]),
        ];
        const f = composeQuadrants(parts)!.frames[0]!;
        expect(f.width).toBe(2);
        expect(f.height).toBe(2);
    });
});
