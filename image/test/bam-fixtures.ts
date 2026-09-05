/**
 * Multi-cycle BAM v1 builders, written through this package's own serializer rather than typed by hand.
 *
 * They live here because the writer does: both the client's thumbnail tests and the animation package's
 * stance tests need a BAM whose cycles are told apart by content, and a copy in either would drift from
 * the other. Consumers outside this package import them by relative path - the dependency direction is
 * the same one their `@bgforge/image` imports already take.
 */
import { type IndexedAnimation, type Rgba, serializeBamV1 } from "../src/index.ts";

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
        sequences: Array.from({ length: 8 }, (_, cycle) => ({
            frameRefs: drawn.includes(cycle) ? [0, 1] : [0, 0],
            facing: "none" as const,
        })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}
