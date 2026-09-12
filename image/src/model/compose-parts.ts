// Node-free, like the rest of `model/`: composition is pure pixel arithmetic and a webview may want it.
import type { Frame, IndexedAnimation, Sequence } from "./animation.ts";

/**
 * Compose an animation that ships as several files into one.
 *
 * Three shapes reach here, and they differ only in which files carry what: an oversized creature's four
 * quarters, a huge one's 3x3 grid of tiles (one file per tile PER cycle, the rest of its cycle table left
 * as placeholders), and any unmirrored animation paired with the eastern twin holding the facings the
 * engine mirrors for everyone else. In all three the pieces are NOT alternatives - each is part of one picture -
 * and they reassemble by their anchors: a frame is drawn at `-offset`, so the parts tile around a shared
 * origin and the union of their rectangles is the whole.
 *
 * Measured across the shipped animations of each shape: the parts carry an IDENTICAL palette, and their
 * rectangles never overlap. The first is what lets indexed pixels merge without remapping; the second is
 * not relied on - a transparent source pixel never overwrites, so an overlap composes rather than erases.
 *
 * Returns undefined when the parts of a SPATIAL split disagree about their cycles, which is the one case
 * where composing would silently pair frames that are not the same moment. Files dividing the picture by
 * facing never hold one cycle between them, so a difference there is one file's dead slot.
 */
export function composeParts(parts: readonly IndexedAnimation[]): IndexedAnimation | undefined {
    const [reference] = parts;
    if (reference === undefined) return undefined;
    // Each part's frames by pixel count, which is what tells its padded slots from its art. Computed
    // once: every cycle asks the question of every part, and a frame's size does not change.
    const areas = parts.map((part) => part.frames.map((frame) => frame.width * frame.height));
    const byFacing = dividesByFacing(parts);
    const spine = spineOf(parts, reference);
    if (!byFacing && !cyclesAgree(parts, spine)) return undefined;

    const transparent = reference.meta.transparentIndex ?? 0;
    const frames: Frame[] = [];
    // A BAM reuses one frame across cycles, so composing per cycle POSITION would multiply the frame
    // table by the number of cycles. Key by the parts' own frame refs: the same combination composes once.
    const byRefs = new Map<string, number>();

    const sequences: Sequence[] = spine.sequences.map((sequence, cycle) => {
        // Only the parts that DRAW this cycle contribute: a part holding a placeholder for it would
        // otherwise be laid over the art of the part that has it, which is the mirrored-twin shape.
        const contributing = contributorsTo(parts, areas, cycle, byFacing);
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

/** Where a part's frame sits around the shared anchor - the rectangle the composition above unions. */
export interface PartRect {
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
}

/**
 * Cut a composed frame back into the parts it came from - the write-side inverse of `composeFrame`.
 *
 * It needs the ORIGINAL rectangles because composition keeps no record of the seams: the union is just a
 * picture, and nothing in it says where one tile ended. Faithful wherever the parts do not overlap, which
 * is the measured shape of every shipped multi-file animation; where two do overlap, a pixel goes to every
 * part whose rectangle covers it, since there is no longer anything to say which drew it.
 *
 * A part reaching outside the composed frame reads transparent there rather than throwing - that is a part
 * the composition never drew, and refusing it would fail a whole set over one empty tile.
 */
export function splitFrame(composed: Frame, parts: readonly PartRect[], transparent: number): Frame[] {
    return parts.map((part) => {
        const pixels = new Uint8Array(part.width * part.height).fill(transparent);
        const left = composed.offsetX - part.offsetX;
        const top = composed.offsetY - part.offsetY;
        for (let row = 0; row < part.height; row++) {
            const sourceRow = top + row;
            if (sourceRow < 0 || sourceRow >= composed.height) continue;
            for (let column = 0; column < part.width; column++) {
                const sourceColumn = left + column;
                if (sourceColumn < 0 || sourceColumn >= composed.width) continue;
                // Both coordinates were bounds-checked just above, so the read is in range; the possibly-
                // undefined type comes from `noUncheckedIndexedAccess`, not from anything absent at runtime.
                pixels[row * part.width + column] = composed.pixels[sourceRow * composed.width + sourceColumn]!;
            }
        }
        return { width: part.width, height: part.height, pixels, offsetX: part.offsetX, offsetY: part.offsetY };
    });
}

/**
 * A single pixel is the placeholder a packed file's undrawn bands are made of.
 *
 * Measured per band of every character file across a classic and an Enhanced install: an undrawn band's
 * cycles reference nothing but `1x1` frames, while a drawn one holds sprites of some thirty by forty.
 * Nothing depicts a creature in one pixel, and a file cannot omit the bands it does not draw - the engine
 * finds a band by its position - so this is what tells a skeleton's empty band from a real one.
 */
export const PLACEHOLDER_FRAME_AREA = 1;

/** Whether a cycle draws anything, given each frame's pixel count in frame order. */
export function cycleDrawsArt(frameRefs: readonly number[], areas: readonly number[]): boolean {
    return frameRefs.some((ref) => (areas[ref] ?? 0) > PLACEHOLDER_FRAME_AREA);
}

/**
 * Whether a part plays an ANIMATION in a cycle, as opposed to standing on one frame.
 *
 * The files pad an unstored facing two ways, both measured on shipped demons: one repeats a single pixel,
 * the other points once at a frame it draws elsewhere. Neither varies, and that is the test - a part that
 * varies its frames is playing something, and its length is a sequence of moments another part's length
 * has to line up with.
 */
export function drawsCycle(sequence: Sequence | undefined): boolean {
    if (sequence === undefined || sequence.frameRefs.length === 0) return false;
    return !sequence.frameRefs.every((ref, _, refs) => ref === refs[0]);
}

/**
 * Whether the parts divide the picture by FACING rather than by space.
 *
 * A mirrored pair pads exactly the cycles its partner draws, so no cycle is held by both of them and a
 * length difference between the two is one file's dead slot rather than a contradiction. A spatial split -
 * quarters, tiles - has every part drawing every cycle, and there a difference IS a contradiction.
 */
function dividesByFacing(parts: readonly IndexedAnimation[]): boolean {
    return parts.some((part) =>
        part.sequences.some(
            (sequence, cycle) =>
                !drawsCycle(sequence) && parts.some((other) => other !== part && drawsCycle(other.sequences[cycle])),
        ),
    );
}

/**
 * The parts whose art this cycle is composed from.
 *
 * Animation first, since a part that plays one is unambiguously drawing the cycle. Where none does, the
 * parts holding PIXELS for it: a still is one frame like a pad is, so only the frame's size tells them
 * apart, and taking the pads too would lay a single pixel over the art. Where nothing holds pixels the
 * cycle is blank in every part, and composing them all keeps a genuinely empty slot as it was.
 *
 * Where the files divide by facing and two of them still animate one cycle, the longer entry is the file
 * that stores the facing: a file stores a facing whole, and pads the rest with whatever is left in the
 * slot. The squirrel's base pads two of its facings from a pair of leftover frames rather than one
 * repeated, and reading those four frames as a rival animation cost the whole creature.
 */
function contributorsTo(
    parts: readonly IndexedAnimation[],
    areas: readonly (readonly number[])[],
    cycle: number,
    byFacing: boolean,
): readonly IndexedAnimation[] {
    const animated = parts.filter((part) => drawsCycle(part.sequences[cycle]));
    if (byFacing && animated.length > 1) {
        const longest = Math.max(...animated.map((part) => part.sequences[cycle]?.frameRefs.length ?? 0));
        return animated.filter((part) => (part.sequences[cycle]?.frameRefs.length ?? 0) === longest);
    }
    if (animated.length > 0) return animated;
    const holding = parts.filter((part, at) => cycleDrawsArt(part.sequences[cycle]?.frameRefs ?? [], areas[at] ?? []));
    return holding.length > 0 ? holding : parts;
}

/**
 * The part whose cycle table the composition follows: the longest one.
 *
 * A twin that holds only the facings it draws still has to reach the cycle POSITIONS those facings sit at,
 * and the base file stops short of them - so following the first part would compose away exactly the
 * facings the twin exists to supply.
 */
function spineOf(parts: readonly IndexedAnimation[], reference: IndexedAnimation): IndexedAnimation {
    return parts.reduce(
        (longest, part) => (part.sequences.length > longest.sequences.length ? part : longest),
        reference,
    );
}

/**
 * The parts of a SPATIAL split must agree on each cycle's length, or they cannot be composed.
 *
 * Asked only of files that divide the picture between them at every moment - quarters and tiles - since
 * those are the ones whose lengths are claims about the same animation. Two of them drawing one cycle at
 * different lengths is a real disagreement: composing them would pair frames that are not the same moment.
 *
 * A placeholder is an absence rather than a disagreement, and so is a MISSING entry: a twin that holds only
 * the facings it draws stops its table short of the ones it does not, which is why the parts need not hold
 * the same number of cycles.
 *
 * A part standing on ONE frame has no moments to misalign, so its length is not a claim about timing and
 * cannot contradict anybody's: the demons pad ten facings of their twitch with three copies of a single
 * pixel while the twin's art for the same facings is a one-frame still, and reading three against one as a
 * contradiction refused the member carrying their stand, hit, death and get-up.
 */
function cyclesAgree(parts: readonly IndexedAnimation[], spine: IndexedAnimation): boolean {
    return spine.sequences.every((_, cycle) => {
        const lengths = parts
            .filter((part) => drawsCycle(part.sequences[cycle]))
            .map((part) => part.sequences[cycle]?.frameRefs.length ?? 0);
        return new Set(lengths).size <= 1;
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
