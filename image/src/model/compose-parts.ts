// Node-free, like the rest of `model/`: composition is pure pixel arithmetic and a webview may want it.
import type { Frame, IndexedAnimation, Sequence } from "./animation.ts";

/**
 * Compose an animation that ships as several files into one.
 *
 * Three shapes reach here, and they differ only in which files carry what: an oversized creature's four
 * quarters, a huge one's 3x3 grid of tiles (one file per tile PER cycle, the rest of its cycle table left
 * as placeholders), and an older character file paired with the twin holding the facings the engine
 * mirrors for everyone else. In all three the pieces are NOT alternatives - each is part of one picture -
 * and they reassemble by their anchors: a frame is drawn at `-offset`, so the parts tile around a shared
 * origin and the union of their rectangles is the whole.
 *
 * Measured across the shipped animations of each shape: the parts carry an IDENTICAL palette, and their
 * rectangles never overlap. The first is what lets indexed pixels merge without remapping; the second is
 * not relied on - a transparent source pixel never overwrites, so an overlap composes rather than erases.
 *
 * Returns undefined when the parts disagree about their cycles, which is the one case where composing
 * would silently pair frames that are not the same moment.
 */
export function composeParts(parts: readonly IndexedAnimation[]): IndexedAnimation | undefined {
    const [reference] = parts;
    if (reference === undefined || !cyclesAgree(parts, reference)) return undefined;

    const transparent = reference.meta.transparentIndex ?? 0;
    const frames: Frame[] = [];
    // A BAM reuses one frame across cycles, so composing per cycle POSITION would multiply the frame
    // table by the number of cycles. Key by the parts' own frame refs: the same combination composes once.
    const byRefs = new Map<string, number>();

    const sequences: Sequence[] = reference.sequences.map((sequence, cycle) => {
        // Only the parts that DRAW this cycle contribute: a part holding a placeholder for it would
        // otherwise be laid over the art of the part that has it, which is the mirrored-twin shape.
        const contributing = contributorsTo(parts, cycle);
        const length = Math.max(0, ...contributing.map((part) => part.sequences[cycle]?.frameRefs.length ?? 0));
        // Which parts contribute varies by cycle, so the dedup key names them: two cycles that reuse the
        // same frames of the same parts still share one composed frame, as a BAM's own table does.
        const from = contributing.map((part) => parts.indexOf(part)).join("/");
        return {
            facing: sequence.facing,
            frameRefs: Array.from({ length }, (_, position) => {
                const refs = contributing.map((part) => part.sequences[cycle]?.frameRefs[position] ?? -1);
                const key = `${from}|${refs.join(",")}`;
                const seen = byRefs.get(key);
                if (seen !== undefined) return seen;
                const pieces = contributing.flatMap((part, index) => {
                    const frame = part.frames[refs[index] ?? -1];
                    return frame === undefined ? [] : [frame];
                });
                const index = frames.push(composeFrame(pieces, transparent)) - 1;
                byRefs.set(key, index);
                return index;
            }),
        };
    });

    return { palette: reference.palette, frames, sequences, meta: reference.meta };
}

/**
 * Whether a part holds real art for a cycle, as opposed to a placeholder standing in its slot.
 *
 * A part that does not draw a cycle still carries an entry for it rather than an empty one, and the shape
 * that entry takes is one frame repeated - measured on the older character files, whose base pads the
 * three facings the engine mirrors with a single frame while the twin holds a ten-frame walk for each. A
 * genuinely one-frame cycle reads as a placeholder by this test, which is why the callers fall back to
 * every part where NONE draws: a still animation is then composed as it always was.
 */
export function drawsCycle(sequence: Sequence | undefined): boolean {
    if (sequence === undefined || sequence.frameRefs.length === 0) return false;
    return !sequence.frameRefs.every((ref, _, refs) => ref === refs[0]);
}

/** The parts that draw this cycle, or every part where none does. */
function contributorsTo(parts: readonly IndexedAnimation[], cycle: number): readonly IndexedAnimation[] {
    const drawing = parts.filter((part) => drawsCycle(part.sequences[cycle]));
    return drawing.length > 0 ? drawing : parts;
}

/**
 * Every part must hold the same NUMBER of cycles, and the parts that DRAW a cycle must agree on its length.
 *
 * A placeholder is an absence rather than a disagreement - that is the whole shape of the mirrored twin,
 * whose partner pads exactly the cycles it draws. Two parts that both draw a cycle at different lengths
 * are a real disagreement: composing them would pair frames that are not the same moment.
 */
function cyclesAgree(parts: readonly IndexedAnimation[], reference: IndexedAnimation): boolean {
    if (parts.some((part) => part.sequences.length !== reference.sequences.length)) return false;
    return reference.sequences.every((_, cycle) => {
        const lengths = contributorsTo(parts, cycle).map((part) => part.sequences[cycle]?.frameRefs.length ?? 0);
        return new Set(lengths.filter((length) => length > 0)).size <= 1;
    });
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
