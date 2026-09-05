// Node-free, like the rest of `model/`: composition is pure pixel arithmetic and a webview may want it.
import type { Frame, IndexedAnimation, Sequence } from "./animation.ts";

/**
 * Compose an oversized creature's quadrant files into one animation.
 *
 * The largest creature animations do not fit one BAM, so they ship as four files holding one quarter of
 * the sprite each. The pieces are NOT alternatives to choose between - all four are needed to see the
 * creature - and they reassemble by their anchors: each frame is drawn at `-offset`, so the parts tile
 * around a shared origin and the union of their rectangles is the whole.
 *
 * Measured across the shipped quadrant animations: the parts carry an IDENTICAL palette and an identical
 * cycle structure, and their rectangles never overlap. The first two facts are what let indexed pixels
 * merge without remapping; the third is not relied on - a transparent source pixel never overwrites, so
 * an overlap composes rather than erases.
 *
 * Returns undefined when the parts disagree about their cycles, which is the one case where composing
 * would silently pair frames that are not the same moment.
 */
export function composeQuadrants(parts: readonly IndexedAnimation[]): IndexedAnimation | undefined {
    const [reference] = parts;
    if (reference === undefined || !cyclesAgree(parts, reference)) return undefined;

    const transparent = reference.meta.transparentIndex ?? 0;
    const frames: Frame[] = [];
    // A BAM reuses one frame across cycles, so composing per cycle POSITION would multiply the frame
    // table by the number of cycles. Key by the parts' own frame refs: the same combination composes once.
    const byRefs = new Map<string, number>();

    const sequences: Sequence[] = reference.sequences.map((sequence, cycle) => ({
        facing: sequence.facing,
        frameRefs: sequence.frameRefs.map((_, position) => {
            const refs = parts.map((part) => part.sequences[cycle]?.frameRefs[position] ?? -1);
            const key = refs.join(",");
            const seen = byRefs.get(key);
            if (seen !== undefined) return seen;
            const pieces = parts.flatMap((part, index) => {
                const frame = part.frames[refs[index] ?? -1];
                return frame === undefined ? [] : [frame];
            });
            const index = frames.push(composeFrame(pieces, transparent)) - 1;
            byRefs.set(key, index);
            return index;
        }),
    }));

    return { palette: reference.palette, frames, sequences, meta: reference.meta };
}

/** Every part must hold the same cycles of the same lengths, or frames would pair across moments. */
function cyclesAgree(parts: readonly IndexedAnimation[], reference: IndexedAnimation): boolean {
    return parts.every(
        (part) =>
            part.sequences.length === reference.sequences.length &&
            part.sequences.every(
                (sequence, cycle) => sequence.frameRefs.length === reference.sequences[cycle]?.frameRefs.length,
            ),
    );
}

/**
 * One frame from the parts' frames at the same moment.
 *
 * Each piece occupies `[-offset, -offset + size)` around the shared anchor, so the union of those
 * rectangles is the composed frame and its own anchor is wherever the origin fell inside it.
 */
function composeFrame(pieces: readonly Frame[], transparent: number): Frame {
    // A zero-area piece has no rectangle to union - including it would drag the bounds to its anchor.
    const drawn = pieces.filter((piece) => piece.width > 0 && piece.height > 0);
    if (drawn.length === 0) return { width: 0, height: 0, pixels: new Uint8Array(), offsetX: 0, offsetY: 0 };

    const minX = Math.min(...drawn.map((piece) => -piece.offsetX));
    const minY = Math.min(...drawn.map((piece) => -piece.offsetY));
    const maxX = Math.max(...drawn.map((piece) => -piece.offsetX + piece.width));
    const maxY = Math.max(...drawn.map((piece) => -piece.offsetY + piece.height));

    const width = maxX - minX;
    const height = maxY - minY;
    const pixels = new Uint8Array(width * height).fill(transparent);
    for (const piece of drawn) {
        const left = -piece.offsetX - minX;
        const top = -piece.offsetY - minY;
        for (let row = 0; row < piece.height; row++) {
            for (let column = 0; column < piece.width; column++) {
                const value = piece.pixels[row * piece.width + column] ?? transparent;
                // Transparent source pixels are skipped rather than written: where two parts do overlap,
                // one's empty margin must not punch a hole in the other's image.
                if (value === transparent) continue;
                pixels[(top + row) * width + left + column] = value;
            }
        }
    }
    return { width, height, pixels, offsetX: -minX, offsetY: -minY };
}
