import { describe, expect, test } from "vitest";
import type { Frame, IndexedAnimation, Rgba } from "../src/model/animation.ts";
import { composeParts, cycleDrawsArt, splitFrame } from "../src/model/compose-parts.ts";

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

describe("composeParts", () => {
    test("unions the parts into one frame that keeps the shared anchor", () => {
        const composed = composeParts(quadrantParts());
        const first = composed?.frames[0];
        // x spans -4..3 and y spans -4..1, so 7x5 with the anchor 4 in and 4 down.
        expect(first?.width).toBe(7);
        expect(first?.height).toBe(5);
        expect(first?.offsetX).toBe(4);
        expect(first?.offsetY).toBe(4);
    });

    test("places each part in its own quarter", () => {
        const composed = composeParts(quadrantParts());
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
        const composed = composeParts(parts);
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
        expect(composeParts(parts)?.frames).toHaveLength(2);
    });

    test("does not let one part's transparent pixels erase another's image", () => {
        // Overlapping rectangles: the second part is transparent where the first has content.
        const parts = [
            animation([frame(2, 1, 2, 1, 7)], [[0]]),
            animation([{ ...frame(2, 1, 2, 1, 0), pixels: new Uint8Array([0, 0]) }], [[0]]),
        ];
        const f = composeParts(parts)!.frames[0]!;
        expect([...f.pixels]).toEqual([7, 7]);
    });

    test("carries the parts' shared palette and transparent index", () => {
        const composed = composeParts(quadrantParts());
        expect(composed?.palette).toHaveLength(256);
        expect(composed?.meta.transparentIndex).toBe(0);
        expect(composed?.meta.sourceFormat).toBe("bam");
    });

    test("a lone part composes to an animation of the same shape", () => {
        const composed = composeParts([animation([frame(3, 2, 1, 1, 5)], [[0]])]);
        expect(composed?.frames[0]?.width).toBe(3);
        expect(composed?.frames[0]?.offsetX).toBe(1);
        expect(composed?.sequences[0]?.frameRefs).toEqual([0]);
    });

    test("spans the longest part's cycle table rather than the first part's", () => {
        const parts = [animation([frame(2, 2, 2, 2, 1)], [[0]]), animation([frame(2, 2, 0, 2, 2)], [[0], [0]])];
        expect(composeParts(parts)?.sequences).toHaveLength(2);
    });

    test("refuses a cycle two parts of one picture both draw at different lengths", () => {
        // Both hold distinct frames in every cycle, so the files split the picture by space rather than
        // by facing, neither is a pad, and the lengths are a real disagreement.
        const parts = [
            animation([frame(2, 2, 2, 2, 1), frame(2, 2, 2, 2, 2), frame(2, 2, 2, 2, 3)], [[0, 1, 2]]),
            animation([frame(2, 2, 0, 2, 4), frame(2, 2, 0, 2, 5)], [[0, 1]]),
        ];
        expect(composeParts(parts)).toBeUndefined();
    });

    // The shape the older character files ship in: one file holds the facings the engine mirrors for
    // everyone else, so each cycle is drawn by exactly one of the pair and left empty by the other.
    test("takes a cycle from whichever part draws it", () => {
        const west = animation([frame(2, 2, 2, 2, 11)], [[0], []]);
        const east = animation([frame(2, 2, 2, 2, 22)], [[], [0]]);

        const composed = composeParts([west, east]);

        expect(composed?.sequences.map((s) => s.frameRefs.length)).toEqual([1, 1]);
        const [first, second] = composed!.sequences.map((s) => composed!.frames[s.frameRefs[0]!]!);
        expect(first?.pixels[0]).toBe(11);
        expect(second?.pixels[0]).toBe(22);
    });

    // The shape the shipped files actually take: a part that does not draw a cycle pads its slot with one
    // frame repeated rather than leaving it empty, at a length that has nothing to do with the twin's.
    test("ignores a padded cycle in favour of the part that draws it", () => {
        const west = animation(
            [frame(2, 2, 2, 2, 11), frame(2, 2, 2, 2, 12), frame(6, 6, 3, 3, 99)],
            [
                [0, 1],
                [2, 2, 2],
            ],
        );
        const east = animation(
            [frame(6, 6, 3, 3, 88), frame(2, 2, 2, 2, 21), frame(2, 2, 2, 2, 22)],
            [
                [0, 0, 0],
                [1, 2],
            ],
        );

        const composed = composeParts([west, east]);

        expect(composed?.sequences.map((s) => s.frameRefs.length)).toEqual([2, 2]);
        // Each cycle draws only its own part's art: the other's 6x6 pad would have grown both frames.
        expect(composed?.frames[composed.sequences[0]!.frameRefs[0]!]?.width).toBe(2);
        expect(composed?.frames[composed.sequences[1]!.frameRefs[0]!]?.pixels[0]).toBe(21);
    });

    // Where NO part plays an animation the frame's size is the only thing separating a still from a pad.
    // The demons pad ten facings of their twitch with three copies of a single pixel while the twin's art
    // for the same facings is a one-frame still; reading three against one as a length disagreement
    // refused the member carrying their stand, hit, death and get-up.
    test("reads a one-frame still as art beside a longer pad", () => {
        const base = animation(
            [frame(1, 1, 0, 0, 99), frame(2, 2, 2, 2, 11)],
            [
                [1, 1],
                [0, 0, 0],
            ],
        );
        const twin = animation([frame(1, 1, 0, 0, 88), frame(3, 3, 1, 1, 22)], [[0], [1]]);

        const composed = composeParts([base, twin]);

        expect(composed?.sequences.map((cycle) => cycle.frameRefs.length)).toEqual([2, 1]);
        expect(composed?.frames[composed.sequences[1]!.frameRefs[0]!]?.pixels[0]).toBe(22);
    });

    // The squirrel's shape: its base pads two of the facings its twin draws from a pair of leftover frames
    // rather than one repeated, so those pads VARY and read as rival animations four frames long against
    // the twin's six. The pair divides the picture by facing and never both holds a moment, so there is
    // nothing to contradict - and refusing cost the whole creature, the set having only this one member.
    test("takes the longer cycle where the parts divide the picture by facing", () => {
        const base = animation(
            [frame(2, 2, 2, 2, 11), frame(2, 2, 2, 2, 12), frame(2, 2, 2, 2, 13)],
            [
                [0, 1],
                [2, 2, 1, 1],
            ],
        );
        const twin = animation(
            [frame(1, 1, 0, 0, 88), frame(2, 2, 0, 2, 21), frame(2, 2, 0, 2, 22)],
            [
                [0, 0],
                [1, 2, 1, 2, 1, 2],
            ],
        );

        const composed = composeParts([base, twin]);

        expect(composed?.sequences.map((cycle) => cycle.frameRefs.length)).toEqual([2, 6]);
        expect(composed?.frames[composed.sequences[1]!.frameRefs[0]!]?.pixels[0]).toBe(21);
    });

    test("composes a cycle every part only pads, however long the pads run", () => {
        const base = animation([frame(1, 1, 0, 0, 99), frame(2, 2, 2, 2, 11)], [[1], [0, 0, 0]]);
        const twin = animation([frame(1, 1, 0, 0, 88), frame(2, 2, 0, 2, 22)], [[1], [0]]);

        expect(composeParts([base, twin])?.sequences).toHaveLength(2);
    });

    // A missing cycle is an absence, the same as an empty one: an eastern twin stores only the facings it
    // draws, so its table runs PAST a base file that stops at the western five. Refusing the pair on the
    // length difference dropped the eastern facings of most of one shipped section.
    test("takes a cycle the base file does not reach from the part that holds it", () => {
        const west = animation([frame(2, 2, 2, 2, 11)], [[0]]);
        const east = animation([frame(2, 2, 0, 2, 22), frame(2, 2, 0, 2, 33)], [[], [0, 1]]);

        const composed = composeParts([west, east]);

        expect(composed?.sequences.map((cycle) => cycle.frameRefs.length)).toEqual([1, 2]);
        expect(composed?.frames[composed.sequences[1]!.frameRefs[0]!]?.pixels[0]).toBe(22);
    });

    test("refuses an empty part list", () => {
        expect(composeParts([])).toBeUndefined();
    });

    test("skips a zero-area part rather than letting it grow the bounding box", () => {
        const parts = [
            animation([frame(2, 2, 2, 2, 9)], [[0]]),
            animation([{ width: 0, height: 0, pixels: new Uint8Array(), offsetX: 40, offsetY: 40 }], [[0]]),
        ];
        const f = composeParts(parts)!.frames[0]!;
        expect(f.width).toBe(2);
        expect(f.height).toBe(2);
    });
});

describe("splitFrame", () => {
    /**
     * The property the writer rests on: a picture composed from its parts splits back into exactly those
     * parts. Anything less and a converted tiled set would be written with its seams in the wrong places,
     * which no per-file comparison would catch - each tile is a valid BAM either way.
     */
    test("cuts a composed frame back into the parts it was composed from", () => {
        const parts = quadrantParts();
        const composed = composeParts(parts)!.frames[0]!;
        const rects = parts.map((part) => part.frames[0]!);

        expect(splitFrame(composed, rects, 0)).toEqual(rects);
    });

    /**
     * A part whose rectangle falls outside the picture is empty, not an error - it drew nothing. Both axes
     * are exercised: a part clear of the frame horizontally never reaches the vertical bound at all, so one
     * of them would otherwise go unrun.
     */
    test("reads transparent for a part lying outside the composed frame on either axis", () => {
        const composed = frame(2, 2, 0, 0, 7);

        const [besideIt, aboveIt] = splitFrame(
            composed,
            [
                { offsetX: -10, offsetY: 0, width: 2, height: 2 },
                { offsetX: 0, offsetY: -10, width: 2, height: 2 },
            ],
            3,
        );

        expect([...besideIt!.pixels]).toEqual([3, 3, 3, 3]);
        expect([...aboveIt!.pixels]).toEqual([3, 3, 3, 3]);
    });

    /**
     * Splitting on a grid the picture was never composed from is legitimate - a conversion into a tiled
     * target picks its own seams - so the cut follows the rectangles given, not any remembered geometry.
     */
    test("cuts on whatever rectangles it is given, not the original seams", () => {
        // One 4x1 strip of distinct values, cut into two 2x1 halves the composition never had.
        const composed: Frame = { width: 4, height: 1, pixels: new Uint8Array([1, 2, 3, 4]), offsetX: 0, offsetY: 0 };

        const halves = splitFrame(
            composed,
            [
                { offsetX: 0, offsetY: 0, width: 2, height: 1 },
                { offsetX: -2, offsetY: 0, width: 2, height: 1 },
            ],
            0,
        );

        expect(halves.map((half) => [...half.pixels])).toEqual([
            [1, 2],
            [3, 4],
        ]);
    });
});

describe("cycleDrawsArt", () => {
    // Areas in frame order: two placeholders, then a sprite.
    const areas = [1, 1, 900];

    test("reads a cycle of single-pixel frames as the placeholder it is", () => {
        expect(cycleDrawsArt([0, 1], areas)).toBe(false);
    });

    test("reads a cycle as drawing where any one of its frames is bigger than a pixel", () => {
        expect(cycleDrawsArt([0, 2], areas)).toBe(true);
    });

    test("reads an empty cycle, and one naming a frame the table does not hold, as drawing nothing", () => {
        expect(cycleDrawsArt([], areas)).toBe(false);
        expect(cycleDrawsArt([7], areas)).toBe(false);
    });
});
