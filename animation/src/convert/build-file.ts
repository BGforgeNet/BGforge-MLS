/**
 * Rebuild one SOURCE FILE as one TARGET FILE.
 *
 * The file is the unit a game reads, not the action: a creature file packs several actions as consecutive
 * direction blocks sharing one frame pool, and converting an action at a time would emit that pool once per
 * action. So the bands of a file are laid out together, into the blocks the target's own files take.
 *
 * The block, not the stored count, is what decides the layout. A scheme that stores five facings still
 * writes eight-slot blocks, because the engine reads slot 5 of each block as the first mirrored facing - a
 * file packing five cycles per band would put the next band's art where the east belongs.
 */
import { type Facing, type IndexedAnimation, type Sequence, ieFacingsForStride } from "@bgforge/image";
import { type NeutralAction } from "../neutral/model";
import { type ConversionTarget } from "./target";
import { retargetAction } from "./retarget";

/** A slot the target's blocks have and this source drew nothing for. Its cycle exists and is empty. */
const EMPTY_SLOT: Sequence = { frameRefs: [], facing: "none" };

/**
 * The direction slots one of the target's files lays out, in the order it stores them.
 *
 * A block target's slots are the whole block, mirrored positions included, because the engine reads those
 * positions whether or not this source fills them. A rotation target's file holds exactly what it stores.
 * Empty where the block size names no direction order, which refuses the file rather than writing a guess.
 */
export function targetSlots(target: ConversionTarget): readonly Facing[] {
    if (target.files === "frm-rotations") return target.stored;
    return target.stride === undefined ? [] : ieFacingsForStride(target.stride);
}

/**
 * Move a retargeted band's cycles onto the file's own frame pool.
 *
 * A retarget appends its mirrors to a copy of the source pool, so every band's copy holds the same source
 * frames at the same indices and its own mirrors after them. Only those mirrors are new to the file.
 */
function adoptBand(pool: IndexedAnimation["frames"], sourceCount: number, band: IndexedAnimation): Sequence[] {
    const adopted = new Map<number, number>();
    return band.sequences.map((sequence) => ({
        ...sequence,
        frameRefs: sequence.frameRefs.map((ref) => {
            if (ref < sourceCount) return ref;
            const already = adopted.get(ref);
            if (already !== undefined) return already;
            const frame = band.frames[ref];
            // A ref past that band's own pool is the "no frame" sentinel every layer here carries through
            // rather than inventing a frame for.
            if (frame === undefined) return ref;
            pool.push(frame);
            adopted.set(ref, pool.length - 1);
            return pool.length - 1;
        }),
    }));
}

/**
 * A band's cycles in the order the action is PLAYED, which is what a target file stores.
 *
 * A source that draws an action by running its band backwards keeps one copy of the frames and reverses at
 * playback; no target's naming can say that - each of them names one file played forwards - so the direction
 * has to be baked into the frame order here. Per cycle, since a facing is its own clip.
 */
function played(cycles: readonly Sequence[], action: NeutralAction): Sequence[] {
    if (action.reversed !== true) return [...cycles];
    return cycles.map((cycle) => ({ ...cycle, frameRefs: cycle.frameRefs.toReversed() }));
}

/**
 * The file `actions` describe, rebuilt for `target` - undefined where the target's file layout is not
 * modelled here.
 *
 * `actions` are the bands of ONE source file, in the order the file stores them; `source` is the animation
 * they index, which for a member drawn from several files is those files composed into one picture.
 */
export function buildTargetFile(
    source: IndexedAnimation,
    actions: readonly NeutralAction[],
    target: ConversionTarget,
): IndexedAnimation | undefined {
    const slots = targetSlots(target);
    if (slots.length === 0) return undefined;

    const frames = [...source.frames];
    const sequences: Sequence[] = [];
    for (const action of actions) {
        const band = retargetAction(source, action, target);
        const cycles = played(adoptBand(frames, source.frames.length, band.animation), action);
        // Cycles that are not facings keep the length and order the source gave them: a target's direction
        // slots mean nothing to them, and padding them into blocks would claim they are directions.
        if (action.cycles.kind !== "directional") {
            sequences.push(...cycles);
            continue;
        }
        const byFacing = new Map<Facing, Sequence>();
        band.facings.forEach((facing, at) => {
            const cycle = cycles[at];
            /* v8 ignore next -- a retarget returns one facing per cycle it built */
            if (cycle !== undefined) byFacing.set(facing, cycle);
        });
        for (const facing of slots) sequences.push(byFacing.get(facing) ?? EMPTY_SLOT);
    }

    return { ...source, frames, sequences };
}

/** The band skeleton a target's file carries: how many bands, and which one this action's art draws. */
export interface BandLayout {
    bands: number;
    at: number;
}

/**
 * Seat a one-band file in the skeleton its target's naming family gives it.
 *
 * A family whose files all carry the same bands addresses a band by its POSITION, so the empty ones have to
 * be written too - a file holding only the band it draws would play the walk where the stance belongs. The
 * empty bands are empty CYCLES, the same "nothing to draw here" the layout above already writes for a facing
 * the source has no art for.
 *
 * Undefined where the file is not the single band a skeleton seats: padding a multi-band file would claim a
 * position for cycles that have none.
 */
export function seatInBandLayout(
    file: IndexedAnimation,
    layout: BandLayout,
    stride: number,
): IndexedAnimation | undefined {
    if (layout.bands === 1) return file;
    // Already the whole skeleton - a source file whose bands ARE the target's file needs no seating.
    if (file.sequences.length === layout.bands * stride) return file;
    if (file.sequences.length !== stride) return undefined;
    const empty = Array.from({ length: stride }, () => EMPTY_SLOT);
    const sequences: Sequence[] = [];
    for (let band = 0; band < layout.bands; band++) sequences.push(...(band === layout.at ? file.sequences : empty));
    return { ...file, sequences };
}
