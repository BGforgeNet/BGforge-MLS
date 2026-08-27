import {
    type Animation,
    type RgbaAnimation,
    type RgbaFrame,
    type Sequence,
    isRgbaAnimation,
} from "../model/animation.ts";
import { LossReport } from "./loss-report.ts";
import { convertToRgba } from "./to-rgba.ts";

/**
 * Whether saving this animation must write fresh PVRZ pages, i.e. whether its frames still carry the
 * data blocks they were read from. A caller has to know before it saves, because the page number to
 * start at is a decision only it can make - see BamV2SaveOptions.basePage.
 */
export function needsFreshPages(anim: RgbaAnimation): boolean {
    return anim.sourcePages === undefined || anim.frames.some((f) => f.sourceBlocks === undefined);
}

/** Is every cycle already a contiguous ascending run of frame indices? */
function cyclesAreContiguous(sequences: Sequence[]): boolean {
    return sequences.every((seq) => seq.frameRefs.every((ref, i) => ref === (seq.frameRefs[0] ?? 0) + i));
}

/**
 * Re-lay the frames so each cycle occupies one contiguous ascending run, duplicating any frame two
 * cycles share. A v2 cycle is a start index plus a count, so this is the only shape the format can
 * express - and the alternative, dropping or reordering references, would change what plays.
 *
 * Frames no cycle references are appended afterwards rather than dropped: they sit past every
 * cycle's run, so they cost nothing but a table entry and the animation stays whole.
 */
function makeCyclesContiguous(anim: RgbaAnimation): { animation: RgbaAnimation; duplicated: number } {
    const frames: RgbaFrame[] = [];
    const emitted = new Set<number>();
    let duplicated = 0;

    const sequences = anim.sequences.map((seq) => {
        const frameRefs = seq.frameRefs.map((ref) => {
            const frame = anim.frames[ref];
            if (frame === undefined)
                throw new Error(`convertToBamV2: cycle references out-of-range frame index ${ref}`);
            if (emitted.has(ref)) duplicated++;
            emitted.add(ref);
            frames.push(frame);
            return frames.length - 1;
        });
        return { ...seq, frameRefs };
    });

    for (const [index, frame] of anim.frames.entries()) {
        if (!emitted.has(index)) frames.push(frame);
    }

    return { animation: { ...anim, frames, sequences }, duplicated };
}

/**
 * Bring any animation into BAM v2's shape: true-colour frames, and cycles laid out as contiguous
 * runs. An animation already in that shape is returned as it stands, PAGE PROVENANCE AND ALL - a
 * rebuild would strip it and force a lossy re-encode of pixels nothing had touched.
 */
export function convertToBamV2(anim: Animation): { animation: RgbaAnimation; report: LossReport } {
    const report = new LossReport();
    const rgba = isRgbaAnimation(anim) ? anim : convertToRgba(anim);
    if (cyclesAreContiguous(rgba.sequences)) return { animation: rgba, report };

    const { animation, duplicated } = makeCyclesContiguous(rgba);
    if (duplicated > 0) {
        report.add(
            "duplicated-shared-frames",
            `${duplicated} frame reference(s) shared between cycles were duplicated - a BAM v2 cycle is a contiguous run of frames, so it cannot point back at one another cycle already used`,
        );
    }
    return { animation, report };
}
