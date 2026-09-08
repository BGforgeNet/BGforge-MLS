/**
 * Cheap heuristics for a BAM that packs more than one directional set into its flat cycle list - most
 * often an IE creature animation (actions x directions stored as ~N numbered cycles with no metadata
 * saying which cycle is which). A BAM carries NO sequence or direction tag, so without a resolved scheme
 * this can only GUESS from the cycle structure; the true layout lives in external IE animation tables
 * (animate.ids / per-animation INIs), not in the file. Detection seeds defaults - the user confirms or
 * overrides via the layout (rose/grid) selector and the grid-columns control. The interpretation itself
 * lives in the library (@bgforge/image/ie-direction), where the BAM parser resolves meta.directionLayout
 * from it; the block NAMES live in @bgforge/animation/group-labels, which the set browser needs too. This
 * module keeps the webview-only presentation heuristics (grid columns, option text).
 */
import { ieBlockSize, type IeScheme } from "@bgforge/image/ie-direction";
import { type IeGroup, blockLabel } from "@bgforge/animation/group-labels";

export interface CycleGridAnalysis {
    /** More cycles than a single directional set can hold (>8) - so it is NOT one direction rose but
     *  several sequences flattened together. A hint, never a certainty. */
    multiSequence: boolean;
    /** Suggested column count to lay the flat cycles into a rows=sequences, columns=directions grid.
     *  Biased to the IE 8-direction norm (then 6), preferring a count that tiles evenly. 0 when a single
     *  set. */
    suggestedColumns: number;
    /** True when a scheme supplied the block size, so the numbers above are a division rather than a
     *  guess. The hint the user reads turns on this: it is the difference between telling them to lay
     *  the blocks out by hand and showing them the structure that was read. */
    resolved: boolean;
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
            ? { multiSequence: true, suggestedColumns: stride, resolved: true }
            : { multiSequence: false, suggestedColumns: 0, resolved: true };
    }
    if (cycleCount <= MAX_SINGLE_DIRECTION_SET) {
        return { multiSequence: false, suggestedColumns: 0, resolved: false };
    }
    const suggestedColumns = cycleCount % 8 === 0 ? 8 : cycleCount % 6 === 0 ? 6 : 8;
    return { multiSequence: true, suggestedColumns, resolved: false };
}

/** The sentence above the columns box. A resolved analysis has already read the file's block structure,
 *  so it reports it; only an unresolved one asks the reader to work the layout out. Takes a
 *  multi-sequence analysis - the only kind the control is shown for - so the column count is nonzero. */
export function cycleGridHint(cycleCount: number, analysis: CycleGridAnalysis): string {
    if (!analysis.resolved) {
        return `${cycleCount} cycles - looks like a multi-sequence animation (e.g. an IE creature: actions x directions). A BAM names no directions, so the column count is a guess:`;
    }
    const blocks = Math.ceil(cycleCount / analysis.suggestedColumns);
    return `${cycleCount} cycles - ${blocks} blocks of ${analysis.suggestedColumns}, read from the file's own cycle structure:`;
}

/** Option text for one direction group - shared by the webview's group select and the host's FRM
 *  save-as quick pick, so both surfaces name a block identically. Group i covers the i-th block of the
 *  scheme's own size; without a scheme the coarse one is the only reading available. */
export function ieGroupOptionText(blocks: readonly IeGroup[] | undefined, index: number, scheme?: IeScheme): string {
    const stride = ieBlockSize(scheme) ?? MAX_SINGLE_DIRECTION_SET;
    const first = index * stride;
    const block = blocks?.[index];
    // The code-carrying form, not a stance list's: both callers here are showing a reader the blocks of a
    // file they named, so the code that addresses one in an archive listing is what they came for.
    const name = block === undefined ? `Group ${index + 1}` : blockLabel(block);
    return `${name} (cycles ${first}-${first + stride - 1})`;
}

/**
 * Which of a file's direction blocks to offer, by their own index in the file.
 *
 * A block the scheme addresses no sequence to is padding the format forces on the file: it still holds a
 * frame per facing, so nothing structural rules it out and only the declaration can. The stance reader in
 * `@bgforge/animation` drops one on exactly that, and both of this editor's block pickers share this so
 * the three surfaces cannot disagree about what the file contains.
 *
 * Indices are the blocks' own, never their position in the result - the index is how a block is addressed
 * in the file, so dropping one must not renumber the rest.
 */
export function offeredGroups(groupCount: number, blocks?: readonly IeGroup[]): number[] {
    return Array.from({ length: groupCount }, (_, index) => index).filter((index) => blocks?.[index]?.unused !== true);
}
