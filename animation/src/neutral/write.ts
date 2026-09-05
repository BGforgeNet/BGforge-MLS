/**
 * Write a neutral set back to the game it was read from.
 *
 * This is the same-game half of the writer, and it is deliberately the trivial one: a member's animation
 * was never restructured on the way in, so writing it back is re-serializing it in the format it arrived
 * as. That is what makes the round-trip a real gate rather than a tautology - the model either carried
 * everything the file held or it did not, and the comparison is on content rather than bytes because the
 * serializer lays a file out canonically (see `model.ts`).
 *
 * Cross-game conversion is a different function: it BUILDS a new animation for the target's scheme, and
 * every place it cannot carry something across is a reported loss. Nothing here does that.
 */
import { type Animation, encodeBamc, isRgbaAnimation, serializeBamV1 } from "@bgforge/image";
import { type NeutralSet } from "./model";

/** One file to write: where it goes, and the bytes to put there. */
export interface MemberWrite {
    resref: string;
    bytes: Uint8Array;
}

/**
 * Re-serialize one member in the format it was read as.
 *
 * `sourceFormat` is the animation's own record of what it came from, so this cannot drift from what the
 * parser decided. A BAM v2 never reaches here: it is not parseable without its PVRZ pages, so the reader
 * drops it before a member is built (see `read.ts`).
 *
 * Only the two BAM arms exist because only they have a caller: the reader resolves members through an
 * install's archive, which serves BAM. An FRM arm goes in when a Fallout set can be read into a member.
 */
export function serializeMember(animation: Animation, resref: string): Uint8Array {
    if (isRgbaAnimation(animation)) {
        throw new Error(`${resref}: a true-colour BAM has PVRZ pages, which this writer does not carry.`);
    }
    switch (animation.meta.sourceFormat) {
        case "bam":
            return serializeBamV1(animation);
        case "bamc":
            return encodeBamc(serializeBamV1(animation));
        default:
            throw new Error(`${resref}: no writer for source format "${String(animation.meta.sourceFormat)}".`);
    }
}

/**
 * Every file the set writes back, in read order.
 *
 * One write per FILE, not per action: a `G` file packs several actions as consecutive bands, and emitting
 * it once per band would write the same bytes repeatedly and, worse, suggest the bands are separable when
 * they share a frame pool.
 */
export function writeNeutralSet(set: NeutralSet): MemberWrite[] {
    const writes: MemberWrite[] = [];
    const seen = new Set<string>();
    for (const variant of set.variants) {
        for (const [resref, animation] of variant.files) {
            // A file can be shared between armour variants; it is one file on disk either way.
            if (seen.has(resref)) continue;
            seen.add(resref);
            writes.push({ resref, bytes: serializeMember(animation, resref) });
        }
    }
    return writes;
}
