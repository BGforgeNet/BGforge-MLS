/**
 * Cheap heuristics for a BAM that packs more than one directional set into its flat cycle list - most
 * often an IE creature animation (actions x directions stored as ~N numbered cycles with no metadata
 * saying which cycle is which). A BAM carries NO sequence or direction tag, so this can only GUESS from
 * the cycle structure; the true layout lives in external IE animation tables (animate.ids / per-animation
 * INIs), not in the file. Detection only seeds defaults - the user confirms/overrides via the layout
 * (rose/grid) selector and the manual grid-columns control. The direction-block interpretation itself
 * lives in the library (@bgforge/image/ie-direction), where the BAM parser resolves meta.directionLayout
 * from it; this module keeps the webview-only presentation heuristics (grid columns, group labels).
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

/**
 * Known multi-sequence file layouts from the IE animation schemes (IESDP ini_anim.htm), keyed by the
 * filename's trailing sequence token plus the block count - the same token names both the character_old
 * CA/G1 files and the type-2000 monster G1/G2 files, so the count disambiguates. A BAM stores no
 * sequence names; the filename convention is the only in-reach source, so an unmatched token or count
 * falls back to numbered groups. The optional trailing "e" covers eastern *E.BAM companions.
 */
const IE_SEQUENCE_NAMES: Record<string, string[]> = {
    "ca/8": [
        "CA - cast",
        "SP1 - spell loop",
        "CA2 - cast",
        "SP2 - spell loop",
        "CA3 - cast",
        "SP3 - spell loop",
        "CA4 - cast",
        "SP4 - spell loop",
    ],
    "g1/9": [
        "WK - walk",
        "SC1 - combat stance (1-h)",
        "SD1 - stand (1-h)",
        "SC2 - combat stance (2-h)",
        "SD2 - stand (2-h)",
        "GH - get hit",
        "DE - die",
        "TW - twitch",
        "SL - sleep",
    ],
    "g1/6": ["WK - walk", "SC - combat stance", "SD - stand", "GH - get hit", "DE - die", "TW - twitch"],
    "g2/3": ["A1 - attack", "A2/CA - attack or cast", "A3/SP - attack or spell"],
};

const IE_SEQUENCE_TOKENS = ["g1", "g2", "ca"];

/** Scheme names for a multi-block file's direction groups, from the filename's sequence token; undefined
 *  when the token or block count matches no known scheme (callers show numbered groups instead). */
export function ieGroupLabels(basename: string, groupCount: number): string[] | undefined {
    const stem = basename.toLowerCase().replace(/\.[^.]*$/, "");
    for (const candidate of [stem, stem.replace(/e$/, "")]) {
        for (const token of IE_SEQUENCE_TOKENS) {
            if (candidate.endsWith(token)) return IE_SEQUENCE_NAMES[`${token}/${groupCount}`];
        }
    }
    return undefined;
}
