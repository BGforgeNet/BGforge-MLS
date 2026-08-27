import { type IndexedAnimation, type Frame, type Rgba, type Sequence } from "../model/animation.ts";
import { IE_STRIDE, IE_WEST_SLOTS, interpretIeDirections } from "../model/ie-direction.ts";

/**
 * IE creature animations split each direction block across two files: the base BAM stores the west
 * arc (slots 0-4) and leaves the eastern slots (5-7) as dummies, while a `*E.BAM` companion stores
 * the eastern slots in the same block layout. The engine (and every IE browser) reads east
 * orientations from the companion, so the editor combines a pair into one full-rose animation on
 * open and splits it back into the two files on save.
 */

function palettesEqual(a: Rgba[], b: Rgba[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => {
        const other = b[i];
        return other !== undefined && c.r === other.r && c.g === other.g && c.b === other.b && c.a === other.a;
    });
}

function validRefs(refs: number[], frameCount: number): number[] {
    return refs.filter((r) => r >= 0 && r < frameCount);
}

/**
 * Combine a base BAM and its eastern companion into one animation whose blocks carry all 8 slots.
 * Returns undefined when the two do not form a pair: the base must carry the detected base-file
 * fingerprint, the companion must match its cycle count and palette and actually contribute
 * east-facing cycles. Out-of-range frame refs (the 0xFFFF "no frame" sentinel) are dropped.
 */
export function combineIeBamPair(base: IndexedAnimation, east: IndexedAnimation): IndexedAnimation | undefined {
    if (base.sequences.length === 0 || base.sequences.length !== east.sequences.length) return undefined;
    if (base.sequences.length % IE_STRIDE !== 0) return undefined;
    if (!interpretIeDirections(base.sequences, base.frames.length)?.detected) return undefined;
    const eastGroups = interpretIeDirections(east.sequences, east.frames.length)?.groups;
    if (!eastGroups?.some((g) => g.some((s) => s.facing === "NE" || s.facing === "E" || s.facing === "SE"))) {
        return undefined;
    }
    if ((base.meta.transparentIndex ?? 0) !== (east.meta.transparentIndex ?? 0)) return undefined;
    if (!palettesEqual(base.palette, east.palette)) return undefined;

    const offset = base.frames.length;
    const frames: Frame[] = [...base.frames, ...east.frames];
    const sequences: Sequence[] = base.sequences.map((seq, i) => {
        if (i % IE_STRIDE < IE_WEST_SLOTS) return { frameRefs: validRefs(seq.frameRefs, offset), facing: "none" };
        const eastSeq = east.sequences[i];
        return {
            frameRefs: validRefs(eastSeq?.frameRefs ?? [], east.frames.length).map((r) => r + offset),
            facing: "none",
        };
    });
    // The combined shape no longer matches the base-file fingerprint (its east slots are real), so the
    // ie8 layout is asserted here - the combiner just verified it - rather than re-detected.
    return { palette: base.palette, frames, sequences, meta: { ...base.meta, directionLayout: "ie8" } };
}

/**
 * Split a combined pair back into its two on-disk animations: the base keeps the west-arc slots with
 * empty east dummies, the companion keeps the east slots. Undefined when the animation no longer maps
 * onto 8-slot blocks (tagged facings, or a cycle count edits broke off the stride).
 */
export function splitIeBamPair(
    combined: IndexedAnimation,
): { base: IndexedAnimation; east: IndexedAnimation } | undefined {
    if (combined.sequences.length === 0 || combined.sequences.length % IE_STRIDE !== 0) return undefined;
    if (!interpretIeDirections(combined.sequences, combined.frames.length)) return undefined;
    return {
        base: sideAnimation(combined, (slot) => slot < IE_WEST_SLOTS),
        east: sideAnimation(combined, (slot) => slot >= IE_WEST_SLOTS),
    };
}

// One side of the split: kept slots get their cycles with frames compacted into a fresh pool (the
// other side's frames must not ship in this file); dropped slots become empty dummy cycles.
function sideAnimation(combined: IndexedAnimation, keep: (slot: number) => boolean): IndexedAnimation {
    const remap = new Map<number, number>();
    const frames: Frame[] = [];
    const sequences: Sequence[] = combined.sequences.map((seq, i) => {
        if (!keep(i % IE_STRIDE)) return { frameRefs: [], facing: "none" };
        const refs = validRefs(seq.frameRefs, combined.frames.length).map((r) => {
            let mapped = remap.get(r);
            if (mapped === undefined) {
                const frame = combined.frames[r];
                /* v8 ignore next -- refs are range-filtered above */
                if (!frame) throw new Error(`splitIeBamPair: frame ref ${r} out of range`);
                mapped = frames.length;
                frames.push(frame);
                remap.set(r, mapped);
            }
            return mapped;
        });
        return { frameRefs: refs, facing: "none" };
    });
    return { palette: combined.palette, frames, sequences, meta: { ...combined.meta } };
}
