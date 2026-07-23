import type { Facing } from "@bgforge/image";
import type { SequenceView } from "../messages";

/**
 * Cheap heuristics for a BAM that packs more than one directional set into its flat cycle list - most
 * often an IE creature animation (actions x directions stored as ~N numbered cycles with no metadata
 * saying which cycle is which). A BAM carries NO sequence or direction tag, so this can only GUESS from
 * the cycle structure; the true layout lives in external IE animation tables (animate.ids / per-animation
 * INIs), not in the file. Detection only seeds defaults - the user confirms/overrides via the layout
 * (rose/grid) selector and the manual grid-columns control.
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

// IE stored-cycle order within an 8-slot direction block: counterclockwise from due South through West
// to North (slots 0-4), then the eastern slots (5-7). Base files leave 5-7 as dummies - the engine
// mirrors the west cycles, or a separate *E.BAM ships the east - so only E-files populate them.
// (IESDP ini_anim.htm, "Available orientations".)
const IE_SLOT_FACINGS: Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

const IE_STRIDE = 8;

export interface RoseSlot {
    /** Index into AnimationView.sequences. */
    seqIndex: number;
    facing: Facing;
}

export interface IeRoseInterpretation {
    /** One entry per 8-slot direction block: its displayable slots (empty and dummy slots dropped). */
    groups: RoseSlot[][];
    /**
     * Strong base-file fingerprint - stride-8 blocks whose eastern slots are ALL dummies (empty, or a
     * single repeated frame shared across every east slot) while each block has real west cycles.
     * Confident enough to open in rose layout; weaker shapes (a lone <=8-cycle set) stay user-selectable
     * but default to the grid.
     */
    detected: boolean;
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

/**
 * Interpret an untagged (all facings "none") cycle list as IE direction blocks. Returns undefined when
 * the shape cannot map onto 8-slot blocks at all (tagged facings, zero cycles, or a >8 count that is
 * not a multiple of 8) - then only the flat grid makes sense.
 */
export function interpretIeRose(sequences: SequenceView[], frameCount: number): IeRoseInterpretation | undefined {
    if (sequences.length === 0) return undefined;
    if (!sequences.every((seq) => seq.facing === "none")) return undefined;
    if (sequences.length > IE_STRIDE && sequences.length % IE_STRIDE !== 0) return undefined;

    // A ref past the frame table (e.g. the 0xFFFF "no frame" sentinel some E-files carry) is no frame.
    const realRefs = (seq: SequenceView): number[] => seq.frameRefs.filter((r) => r >= 0 && r < frameCount);

    const groupCount = Math.ceil(sequences.length / IE_STRIDE);

    // East slots (5-7) are scheme dummies when every one is empty or a constant frame, with at most ONE
    // shared filler frame across all of them (usar1ca stuffs every east slot with the same frame).
    const fillerRefs = new Set<number>();
    let sawEastSlot = false;
    let eastDummy = true;
    let everyBlockHasWest = true;
    for (let g = 0; g < groupCount; g++) {
        let blockHasWest = false;
        for (let slot = 0; slot < IE_STRIDE; slot++) {
            const seq = sequences[g * IE_STRIDE + slot];
            if (!seq) continue;
            const refs = realRefs(seq);
            if (slot < 5) {
                if (refs.length > 0) blockHasWest = true;
                continue;
            }
            sawEastSlot = true;
            if (refs.length === 0) continue; // empty east slot = dummy
            const first = refs[0];
            if (first !== undefined && refs.every((r) => r === first)) fillerRefs.add(first);
            else eastDummy = false;
        }
        if (!blockHasWest) everyBlockHasWest = false;
    }
    if (fillerRefs.size > 1) eastDummy = false;
    if (!sawEastSlot) eastDummy = false;

    const detected = eastDummy && everyBlockHasWest && sequences.length % IE_STRIDE === 0;

    const groups: RoseSlot[][] = [];
    for (let g = 0; g < groupCount; g++) {
        const slots: RoseSlot[] = [];
        for (let slot = 0; slot < IE_STRIDE; slot++) {
            const seqIndex = g * IE_STRIDE + slot;
            const seq = sequences[seqIndex];
            if (!seq || realRefs(seq).length === 0) continue;
            // In a detected base file the east slots hold filler frames, not east-facing data - drop them.
            if (detected && slot >= 5) continue;
            const facing = IE_SLOT_FACINGS[slot];
            if (facing) slots.push({ seqIndex, facing });
        }
        groups.push(slots);
    }
    return { groups, detected };
}
