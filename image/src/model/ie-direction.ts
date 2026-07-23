// Node-free on purpose (like frame-anchor.ts): the editor webview imports this subpath directly, so it
// must never pull in node:zlib via the barrel.
import type { Facing } from "./animation.ts";

// IE stored-cycle order within an 8-slot direction block: counterclockwise from due South through West
// to North (slots 0-4), then the eastern slots (5-7). Base files leave 5-7 as dummies - the engine
// mirrors the west cycles, or a separate *E.BAM ships the east - so only E-files populate them.
// (IESDP ini_anim.htm, "Available orientations".)
const IE_SLOT_FACINGS: Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

/** Cycles per direction block. */
export const IE_STRIDE = 8;
/** Slots 0-4 are the stored west arc (S..N); 5-7 are the eastern slots a base file leaves as dummies. */
export const IE_WEST_SLOTS = 5;

/** The subset of a sequence this analysis reads - satisfied by both the model's Sequence and the
 *  editor's SequenceView. */
export interface SequenceShape {
    frameRefs: number[];
    facing: Facing;
}

export interface IeDirectionSlot {
    /** Index into the animation's sequences. */
    seqIndex: number;
    facing: Facing;
}

export interface IeDirectionAnalysis {
    /** One entry per 8-slot direction block: its displayable slots (empty and dummy slots dropped). */
    groups: IeDirectionSlot[][];
    /**
     * Strong base-file fingerprint - stride-8 blocks whose eastern slots are ALL dummies (empty, or a
     * single repeated frame shared across every east slot) while each block has real west cycles.
     * Confident enough to resolve the animation's directionLayout to "ie8" at parse time; weaker
     * shapes (a lone <=8-cycle set) stay interpretable but undetected.
     */
    detected: boolean;
}

/**
 * Interpret an untagged (all facings "none") cycle list as IE direction blocks. Returns undefined when
 * the shape cannot map onto 8-slot blocks at all (tagged facings, zero cycles, or a >8 count that is
 * not a multiple of 8) - then only a flat cycle view makes sense.
 */
export function interpretIeDirections(sequences: SequenceShape[], frameCount: number): IeDirectionAnalysis | undefined {
    if (sequences.length === 0) return undefined;
    if (!sequences.every((seq) => seq.facing === "none")) return undefined;
    if (sequences.length > IE_STRIDE && sequences.length % IE_STRIDE !== 0) return undefined;

    // A ref past the frame table (e.g. the 0xFFFF "no frame" sentinel some E-files carry) is no frame.
    const realRefs = (seq: SequenceShape): number[] => seq.frameRefs.filter((r) => r >= 0 && r < frameCount);

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
            if (slot < IE_WEST_SLOTS) {
                if (refs.length > 0) blockHasWest = true;
                continue;
            }
            sawEastSlot = true;
            if (refs.length === 0) continue; // empty east slot = dummy
            const first = refs[0];
            /* v8 ignore next -- refs is non-empty per the check above */
            if (first === undefined) continue;
            if (refs.every((r) => r === first)) fillerRefs.add(first);
            else eastDummy = false;
        }
        if (!blockHasWest) everyBlockHasWest = false;
    }
    if (fillerRefs.size > 1) eastDummy = false;
    if (!sawEastSlot) eastDummy = false;

    const detected = eastDummy && everyBlockHasWest && sequences.length % IE_STRIDE === 0;

    const groups: IeDirectionSlot[][] = [];
    for (let g = 0; g < groupCount; g++) {
        const slots: IeDirectionSlot[] = [];
        for (const [slot, facing] of IE_SLOT_FACINGS.entries()) {
            const seqIndex = g * IE_STRIDE + slot;
            const seq = sequences[seqIndex];
            if (!seq || realRefs(seq).length === 0) continue;
            // In a detected base file the east slots hold filler frames, not east-facing data - drop them.
            if (detected && slot >= IE_WEST_SLOTS) continue;
            slots.push({ seqIndex, facing });
        }
        groups.push(slots);
    }
    return { groups, detected };
}
