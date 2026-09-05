/**
 * Rebuild one action's cycles in a target's own direction order.
 *
 * This is the data half of what the planner describes: the planner says a conversion mirrors, drops or
 * passes facings through, and this performs exactly that. The two read the SAME target profile, so a plan
 * cannot promise something the rebuild does not do.
 *
 * The source is the animation whose `sequences` the action indexes. For a member drawn from several files
 * that is the COMPOSED picture, not one part - a paired member's eastern art lives in its companion, and
 * retargeting the base alone would silently rebuild from the western arc.
 */
import { type Facing, type IndexedAnimation, type Sequence, mirrorFacing, mirrorFrame } from "@bgforge/image";
import { type NeutralAction } from "../neutral/model";
import { type ConversionTarget } from "./target";

export interface RetargetedAction {
    /** The animation to write: the source's frame pool, plus any frame mirrored into it. */
    animation: IndexedAnimation;
    /** The facing of each sequence, in the target's own stored order. */
    facings: readonly Facing[];
}

/** Which sequence index holds each facing the action stores. */
function storedByFacing(directions: readonly { facing: Facing; sequenceIndex: number }[]): Map<Facing, number> {
    const stored = new Map<Facing, number>();
    for (const slot of directions) stored.set(slot.facing, slot.sequenceIndex);
    return stored;
}

export function retargetAction(
    source: IndexedAnimation,
    action: NeutralAction,
    target: ConversionTarget,
): RetargetedAction {
    // A non-directional member's cycles are not facings, so there is no direction order to rebuild them
    // in - and most of what an install ships is this shape. Passing it through is the conversion; folding
    // it into the loop would rebuild it as the empty set of facings the target happens to store.
    if (action.cycles.kind !== "directional") {
        return { animation: source, facings: source.sequences.map((sequence) => sequence.facing) };
    }

    const stored = storedByFacing(action.cycles.directions);
    const frames = [...source.frames];
    const sequences: Sequence[] = [];
    const facings: Facing[] = [];
    // One mirrored frame per source frame, not per facing that reads it: two eastern facings drawing the
    // same western frame share the flip, the way the source's own cycles share their frames.
    const mirroredByRef = new Map<number, number>();

    for (const facing of target.stored) {
        const own = stored.get(facing);
        if (own !== undefined) {
            const sequence = source.sequences[own];
            if (sequence === undefined) continue;
            sequences.push({ ...sequence, facing });
            facings.push(facing);
            continue;
        }
        const partner = stored.get(mirrorFacing(facing));
        if (partner === undefined) continue;
        const sequence = source.sequences[partner];
        if (sequence === undefined) continue;
        const frameRefs = sequence.frameRefs.map((ref) => {
            const already = mirroredByRef.get(ref);
            if (already !== undefined) return already;
            const frame = frames[ref];
            // A ref past the pool is the "no frame" sentinel the reading already ignores; carry it through
            // rather than inventing a frame for it.
            if (frame === undefined) return ref;
            frames.push(mirrorFrame(frame));
            mirroredByRef.set(ref, frames.length - 1);
            return frames.length - 1;
        });
        sequences.push({ frameRefs, facing });
        facings.push(facing);
    }

    return { animation: { ...source, frames, sequences }, facings };
}
