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
