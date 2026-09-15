/**
 * A member's cycle table, merged from the files it draws from.
 *
 * Its own module because two things rest on it and both got it wrong while it was a private helper: the
 * band reader below it, and the pixel composer in the image library, which must agree about which part
 * supplies a given cycle or the bands describe a picture the viewer does not draw.
 */
import { cycleDrawsArt, drawsCycle } from "@bgforge/image";
import type { SequenceShape } from "@bgforge/image/ie-direction";

/** One file's cycle table, which is all the band reading needs - no frame is decoded here. */
export interface PartTables {
    sequences: SequenceShape[];
    frameCount: number;
    /** Each frame's pixel count, so a cycle can be asked whether it draws anything without decoding one. */
    frameAreas: number[];
}

/**
 * The cycle table of a whole member, plus which of its cycles hold art at all.
 *
 * No frame areas of its own: a merged cycle's refs index the frame table of the PART it came from, so the
 * areas are only meaningful beside their own part and the reading they support is already taken below.
 */
export interface MergedTables {
    sequences: SequenceShape[];
    frameCount: number;
    holdsArt: boolean[];
    /**
     * How many of the parts actually supplied a cycle.
     *
     * More than one means the files divide the picture between them, which only the unmirrored schemes do -
     * a spatial split hands every cycle to the same part, since its quarters all draw the same moments. So
     * this says the scheme was identified, where the block structure of the merged table no longer can.
     */
    contributors: number;
}

/** Whether a cycle opens on a frame that draws something rather than on a placeholder. */
export function cycleHoldsArt(sequence: SequenceShape | undefined, areas: readonly number[]): boolean {
    return sequence !== undefined && cycleDrawsArt(sequence.frameRefs, areas);
}

/**
 * The cycle table of a member's whole picture.
 *
 * Per cycle, a part that DRAWS it beats one that only holds a placeholder for it - `drawsCycle` is the
 * composer's own test, so what the band reads and what the viewer draws agree by construction. Reading
 * the first part alone would report a slot as unstored while a sibling file holds its art, which is
 * exactly the unmirrored layouts, whose eastern twin holds the facings the base file pads.
 *
 * Where SEVERAL parts draw one cycle the first wins, which is also what the pixel composer settles on:
 * measured across both shipped installs, the parts that share a drawn cycle agree on its length in all but
 * a handful of members, and the composer refuses exactly those - so preferring a later part here would
 * make the bands describe a picture that then falls back to the base file alone. Cycle indices line up
 * across parts, so a merged entry addresses the same cycle of the composed animation.
 *
 * `drawsCycle` cannot tell a genuine ONE-FRAME cycle from a placeholder - it reads a repeated ref, and a
 * still repeats trivially - so a member whose files are all stills has no drawing part anywhere. The part
 * that holds PIXELS for the cycle answers it, which is the composer's own second reading narrowed to the
 * one sequence a band can be read from. Without it the burrowing family's stills overlay merged nothing
 * and its bands came back three facings short.
 */
export function mergeParts(parts: readonly PartTables[]): MergedTables | undefined {
    const [first] = parts;
    if (first === undefined) return undefined;
    // The longest part's table, not the first's: a twin holding only the facings it draws still reaches the
    // cycle positions those sit at, and the base file stops short of them - the same spine the composer
    // follows, so the bands read here and the picture drawn from them span the same cycles.
    const spine = parts.reduce(
        (longest, part) => (part.sequences.length > longest.length ? part.sequences : longest),
        first.sequences,
    );
    const supplied = new Set<number>();
    const sequences = spine.map((seq, cycle) => {
        const drawing = parts.findIndex((part) => drawsCycle(part.sequences[cycle]));
        const holding = parts.findIndex((part) => cycleHoldsArt(part.sequences[cycle], part.frameAreas));
        const at = drawing === -1 ? holding : drawing;
        const chosen = parts[at]?.sequences[cycle];
        if (chosen === undefined) return seq;
        supplied.add(at);
        return chosen;
    });
    // Judged per part, because a cycle's refs index the frame table of the file they came from - and a
    // cycle draws where ANY part holds pixels for it, which is the same reading the merge above takes.
    return {
        frameCount: Math.max(...parts.map((part) => part.frameCount)),
        sequences,
        contributors: supplied.size,
        holdsArt: sequences.map((_, cycle) =>
            parts.some((part) => cycleHoldsArt(part.sequences[cycle], part.frameAreas)),
        ),
    };
}
