/**
 * Multi-cycle BAM v1 builders, written through this package's own serializer rather than typed by hand.
 *
 * They live here because the writer does: both the client's thumbnail tests and the animation package's
 * stance tests need a BAM whose cycles are told apart by content, and a copy in either would drift from
 * the other. Consumers outside this package import them by relative path - the dependency direction is
 * the same one their `@bgforge/image` imports already take.
 */
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "../src/index.ts";

/** 256 opaque black entries - the neutral base a fixture overwrites only the indices it asserts on. */
export function greyPalette(): Rgba[] {
    return Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
}

/** A BAM of `count` cycles, cycle i opening on a frame filled with palette index i+1 - so a composed tile's
 *  quadrants can be told apart by the index they carry. */
export function multiCycle(edge: number, count: number): Uint8Array {
    const palette = greyPalette();
    for (let i = 1; i <= count; i++) palette[i] = { r: i * 50, g: 255 - i * 50, b: i * 20, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: Array.from({ length: count }, (_, i) => ({
            width: edge,
            height: edge,
            pixels: new Uint8Array(edge * edge).fill(i + 1),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: Array.from({ length: count }, (_, i) => ({ frameRefs: [i], facing: "none" as const })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/**
 * An eight-cycle BAM in the shape a character direction band takes: the cycles named in `drawn` hold two
 * distinct frames, the rest hold one frame repeated.
 *
 * That repetition is what the band reading calls padding - a stored IE character animation carries five
 * facings and pads the three the engine mirrors - so a pair of these is how a base file and its mirrored
 * twin differ, and the only shape that shows whether a member was banded as one picture or as one file.
 */
export function bandedPair(edge: number, drawn: readonly number[]): Uint8Array {
    return packedBands(edge, 1, drawn);
}

/**
 * The same band with one facing a frame longer than the others.
 *
 * The ordinary shape rather than an edge case: a shipped stand runs 76 to 81 frames across its facings.
 * It is what a target storing ONE frame count for every direction has to resolve, and the only fixture
 * under which that resolution does anything at all.
 */
export function unevenBand(edge: number, drawn: readonly number[], longer: number): Uint8Array {
    const palette = greyPalette();
    for (let i = 1; i <= 2; i++) palette[i] = { r: i * 80, g: 255 - i * 80, b: i * 20, a: 255 };
    const square = (index: number): Frame => ({
        width: edge,
        height: edge,
        pixels: new Uint8Array(edge * edge).fill(index),
        offsetX: 0,
        offsetY: 0,
    });
    const animation: IndexedAnimation = {
        palette,
        frames: [square(1), square(2)],
        sequences: Array.from({ length: 8 }, (_, cycle) => ({
            frameRefs: drawn.includes(cycle) ? (cycle === longer ? [0, 1, 0] : [0, 1]) : [0, 0],
            facing: "none" as const,
        })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/**
 * `blocks` eight-cycle bands back to back - the shape a PACKED file takes.
 *
 * The majority of shipped creature animations are this: one BAM holding the walk, the stances, the death
 * and the rest as consecutive direction blocks. `drawn` names the slots of each block that hold real art,
 * so the eastern three stay padding and every block reads as a stored western arc.
 */
/**
 * The shape a character file takes: `blocks` bands of which only `at` holds art, the rest present and
 * empty.
 *
 * The empty bands reference single-pixel frames, which is how the shipped files carry them - the engine
 * addresses a band by its position, so a file cannot simply omit the bands it does not draw. Their cycles
 * still vary their refs, so nothing short of the frame's own size tells them from a drawn band.
 */
export function skeletonBands(edge: number, blocks: number, at: number, drawn: readonly number[]): Uint8Array {
    const palette = greyPalette();
    for (let i = 1; i <= 2; i++) palette[i] = { r: i * 80, g: 255 - i * 80, b: i * 20, a: 255 };
    const square = (index: number, size: number) => ({
        width: size,
        height: size,
        pixels: new Uint8Array(size * size).fill(index),
        offsetX: 0,
        offsetY: 0,
    });
    // Two placeholders, so an empty band's cycles vary their refs exactly as a drawn one's do.
    const animation: IndexedAnimation = {
        palette,
        frames: [square(0, 1), square(0, 1), square(1, edge), square(2, edge)],
        sequences: Array.from({ length: 8 * blocks }, (_, cycle) => {
            if (Math.floor(cycle / 8) !== at) return { frameRefs: [0, 1], facing: "none" as const };
            return { frameRefs: drawn.includes(cycle % 8) ? [2, 3] : [2, 2], facing: "none" as const };
        }),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

export function packedBands(edge: number, blocks: number, drawn: readonly number[]): Uint8Array {
    const palette = greyPalette();
    for (let i = 1; i <= 2; i++) palette[i] = { r: i * 80, g: 255 - i * 80, b: i * 20, a: 255 };
    const square = (index: number) => ({
        width: edge,
        height: edge,
        pixels: new Uint8Array(edge * edge).fill(index),
        offsetX: 0,
        offsetY: 0,
    });
    const animation: IndexedAnimation = {
        palette,
        frames: [square(1), square(2)],
        sequences: Array.from({ length: 8 * blocks }, (_, cycle) => ({
            frameRefs: drawn.includes(cycle % 8) ? [0, 1] : [0, 0],
            facing: "none" as const,
        })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}
