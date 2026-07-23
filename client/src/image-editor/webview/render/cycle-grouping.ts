/**
 * Cheap heuristic for a BAM that packs more than one directional set into its flat cycle list - most
 * often an IE creature animation (actions x directions stored as ~N numbered cycles with no metadata
 * saying which cycle is which). A BAM carries NO sequence or direction tag, so this can only GUESS from
 * the cycle count; the true layout lives in external IE animation tables (animate.ids / per-animation
 * INIs), not in the file. The user confirms/overrides via the manual grid-columns control - detection
 * only seeds a sensible default and a hint.
 */
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

export function analyzeCycleGrid(cycleCount: number): CycleGridAnalysis {
    if (cycleCount <= MAX_SINGLE_DIRECTION_SET) return { multiSequence: false, suggestedColumns: 0 };
    const suggestedColumns = cycleCount % 8 === 0 ? 8 : cycleCount % 6 === 0 ? 6 : 8;
    return { multiSequence: true, suggestedColumns };
}
