/**
 * Cheap heuristics for a BAM that packs more than one directional set into its flat cycle list - most
 * often an IE creature animation (actions x directions stored as ~N numbered cycles with no metadata
 * saying which cycle is which). A BAM carries NO sequence or direction tag, so this can only GUESS from
 * the cycle structure; the true layout lives in external IE animation tables (animate.ids / per-animation
 * INIs), not in the file. Detection only seeds defaults - the user confirms/overrides via the layout
 * (rose/grid) selector and the manual grid-columns control. The direction-block interpretation itself
 * lives in the library (@bgforge/image/ie-direction), where the BAM parser resolves meta.directionLayout
 * from it; the block NAMES live in @bgforge/animation/group-labels, which the set browser needs too. This
 * module keeps the webview-only presentation heuristics (grid columns, option text).
 */
import { ieBlockSize, type IeScheme } from "@bgforge/image/ie-direction";

export interface CycleGridAnalysis {
    /** More cycles than a single directional set can hold (>8) - so it is NOT one direction rose but
     *  several sequences flattened together. A hint, never a certainty. */
    multiSequence: boolean;
    /** Suggested column count to lay the flat cycles into a rows=sequences, columns=directions grid.
     *  Biased to the IE 8-direction norm (then 6), preferring a count that tiles evenly. 0 when a single
     *  set. */
    suggestedColumns: number;
}

// A single directional set is at most 8 cycles (IE's 8 compass directions); anything larger is multiple
// sequences bundled together. This is the whole "creature-ish" signal - deliberately crude and honest.
const MAX_SINGLE_DIRECTION_SET = 8;

export function analyzeCycleGrid(cycleCount: number, scheme?: IeScheme): CycleGridAnalysis {
    // A resolved scheme knows the block size, so "several sequences" is a division rather than a guess.
    // Without one the cycle count is all there is, and >8 is the only signal available.
    const stride = ieBlockSize(scheme);
    if (stride !== undefined) {
        const blocks = Math.ceil(cycleCount / stride);
        return blocks > 1
            ? { multiSequence: true, suggestedColumns: stride }
            : { multiSequence: false, suggestedColumns: 0 };
    }
    if (cycleCount <= MAX_SINGLE_DIRECTION_SET) return { multiSequence: false, suggestedColumns: 0 };
    const suggestedColumns = cycleCount % 8 === 0 ? 8 : cycleCount % 6 === 0 ? 6 : 8;
    return { multiSequence: true, suggestedColumns };
}

/** Option text for one direction group - shared by the webview's group select and the host's FRM
 *  save-as quick pick, so both surfaces name a block identically. Group i covers the i-th block of the
 *  scheme's own size; without a scheme the coarse one is the only reading available. */
export function ieGroupOptionText(labels: string[] | undefined, index: number, scheme?: IeScheme): string {
    const stride = ieBlockSize(scheme) ?? MAX_SINGLE_DIRECTION_SET;
    const first = index * stride;
    return `${labels?.[index] ?? `Group ${index + 1}`} (cycles ${first}-${first + stride - 1})`;
}
