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
import {
    type Animation,
    type LossReport,
    type UnevenRotations,
    convertToFrm,
    encodeBamc,
    isRgbaAnimation,
    serializeBamV1,
    serializeFrm,
} from "@bgforge/image";
import { type NeutralSet } from "./model";

/**
 * One file to write: where it goes, and the bytes to put there.
 *
 * The extension travels with the bytes because only whatever serialized them knows what they are - a
 * conversion writes a format the source never had, so a caller appending one of its own would name a
 * Fallout file `.BAM` and be believed by everything downstream that reads a name to decide a format.
 */
export interface MemberWrite {
    resref: string;
    extension: "BAM" | "FRM";
    bytes: Uint8Array;
}

/**
 * Which BAM container a write lands in.
 *
 * Only the two v1 shapes: BAM v2 keeps its frames in PVRZ pages, and the neutral reader drops a v2 member
 * before a conversion starts because it cannot be read without them - so there is no v2 source to write
 * back and nothing here could produce one.
 */
export type BamContainer = "bam" | "bamc";

/**
 * Re-serialize one member in the format it was read as.
 *
 * `sourceFormat` is the animation's own record of what it came from, so this cannot drift from what the
 * parser decided. A BAM v2 never reaches here: it is not parseable without its PVRZ pages, so the reader
 * drops it before a member is built (see `read.ts`).
 *
 * Only the two BAM arms exist because only they have a caller: the reader resolves members through an
 * install's archive, which serves BAM. Writing a member as a format it did NOT come from is a conversion,
 * and it goes through `serializeAsFrm` beside this rather than through the source's own record.
 */
export function serializeMember(animation: Animation, resref: string, container?: BamContainer): Uint8Array {
    if (isRgbaAnimation(animation)) {
        throw new Error(`${resref}: a true-colour BAM has PVRZ pages, which this writer does not carry.`);
    }
    // The caller's choice where it made one, the member's own record otherwise. A conversion writes a
    // whole set at once, so a reader who wants it uniform has to be able to say so - while the default
    // stays per member, which is what keeps a compressed source compressed.
    const format = container ?? animation.meta.sourceFormat;
    switch (format) {
        case "bam":
            return serializeBamV1(animation);
        case "bamc":
            return encodeBamc(serializeBamV1(animation));
        default:
            throw new Error(`${resref}: no writer for source format "${String(format)}".`);
    }
}

/**
 * Serialize one already-retargeted member as a Fallout FRM.
 *
 * The animation arriving here holds the target's six rotations as its cycles, so the conversion left to do
 * is the palette: an FRM carries no palette of its own and every consumer reads the game's. `nearest` is
 * what the target's `fixedPalette` declares - the exact remap is tried first and only a colour it cannot
 * place is projected onto its closest neighbour, which the caller reports as a real loss.
 *
 * The returned report is the FRM writer's own; the caller merges it so a set-wide conversion says what each
 * file cost rather than only what the plan predicted.
 */
export function serializeAsFrm(
    animation: Animation,
    resref: string,
    unevenRotations?: UnevenRotations,
): { bytes: Uint8Array; report: LossReport; quantized: boolean } {
    if (isRgbaAnimation(animation)) {
        throw new Error(`${resref}: a true-colour BAM has PVRZ pages, which this writer does not carry.`);
    }
    const { animation: frm, report } = convertToFrm(animation, {
        paletteMode: "nearest",
        ...(unevenRotations === undefined ? {} : { unevenRotations }),
    });
    // The writer reports an exact remap and stays silent on a nearest projection, so the absence of that
    // line is what says colours moved. Reading the flag here keeps the judgement with the caller.
    const quantized = !report.items.some((item) => item.kind === "palette-remapped-to-default");
    return { bytes: serializeFrm(frm), report, quantized };
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
            writes.push({ resref, extension: "BAM", bytes: serializeMember(animation, resref) });
        }
    }
    return writes;
}
