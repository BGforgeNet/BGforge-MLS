/**
 * Names for the direction blocks a multi-block IE animation file packs, and what each block depicts.
 *
 * A BAM stores no sequence names, so the filename's trailing sequence token plus the block scheme is the
 * only in-reach source. Kept as its own entry point rather than in the barrel: the animation editor's
 * webview needs these names, and the barrel reaches the image library's Node-only codecs through the
 * stance reader.
 *
 * The block's MEANING is stated here as data beside its name rather than parsed out of it: a converter
 * that read "WK" off the front of a label would be inferring from a display string, and the two would
 * drift the first time a label was reworded.
 */
import { type IeScheme } from "@bgforge/image/ie-direction";
import { type NeutralActionId } from "./animation-schemes/actions";

/** One block of a packed file: what a picker shows, and what the block depicts where that is pinned. */
export interface IeGroup {
    label: string;
    /** Absent where the documentation names the block without pinning what it is - see `CAST_BLOCKS`. */
    id?: NeutralActionId;
    /** The grip the block's own name pins, where it pins one. */
    detail?: string;
}

// The FIRST block of each pair is the conjure loop played while casting, the SECOND the one-shot
// release (engine playback order; note IESDP's CA/SP block names invert it). Both schemes lay their
// cast files out this way - only the block size differs - so the two keys share one list.
//
// No `id`: the vocabulary's `spell` covers both halves precisely because the sources disagree about
// which is which, so a block that IS one of the two is exactly the case it refuses to name.
const CAST_BLOCKS: IeGroup[] = [
    { label: "Conjure spell 1 (loop)" },
    { label: "Cast spell 1 (release)" },
    { label: "Conjure spell 2 (loop)" },
    { label: "Cast spell 2 (release)" },
    { label: "Conjure spell 3 (loop)" },
    { label: "Cast spell 3 (release)" },
    { label: "Conjure spell 4 (loop)" },
    { label: "Cast spell 4 (release)" },
];

/**
 * Known multi-sequence file layouts from the IE animation schemes (IESDP ini_anim.htm), keyed by the
 * filename's trailing sequence token, the block scheme, and the block count. All three are needed: one
 * token names several families, and a G1 of nine coarse blocks is a different animation from a G1 of
 * nine fine ones. A BAM stores no sequence names; the filename convention is the only in-reach source,
 * so an unmatched key falls back to numbered groups. The optional trailing "e" covers eastern *E.BAM
 * companions. Block sets the documentation does not pin down are deliberately absent rather than
 * guessed - a numbered group is honest, a wrong name is not.
 */
const IE_SEQUENCE_NAMES: Record<string, IeGroup[]> = {
    "ca/ie8/8": CAST_BLOCKS,
    "ca/ie9/8": CAST_BLOCKS,
    "g1/ie8/9": [
        { label: "WK - walk", id: "walk" },
        { label: "SC1 - combat stance (1-h)", id: "ready", detail: "1-handed" },
        { label: "SD1 - stand (1-h)", id: "stand", detail: "1-handed" },
        { label: "SC2 - combat stance (2-h)", id: "ready", detail: "2-handed" },
        { label: "SD2 - stand (2-h)", id: "stand", detail: "2-handed" },
        { label: "GH - get hit", id: "get-hit" },
        { label: "DE - die", id: "die" },
        { label: "TW - twitch", id: "twitch" },
        { label: "SL - sleep", id: "sleep" },
    ],
    "g1/ie8/6": [
        { label: "WK - walk", id: "walk" },
        { label: "SC - combat stance", id: "ready" },
        { label: "SD - stand", id: "stand" },
        { label: "GH - get hit", id: "get-hit" },
        { label: "DE - die", id: "die" },
        { label: "TW - twitch", id: "twitch" },
    ],
    // The second and third blocks are each documented as one of two things, so neither is pinned.
    "g2/ie8/3": [
        { label: "A1 - attack", id: "attack" },
        { label: "A2/CA - attack or cast" },
        { label: "A3/SP - attack or spell" },
    ],
    // Fine-scheme monster (unsplit G1/G2) and character G1.
    "g1/ie9/8": [
        { label: "WK - walk", id: "walk" },
        { label: "SC - combat stance", id: "ready" },
        { label: "SD - stand", id: "stand" },
        { label: "GH - get hit", id: "get-hit" },
        { label: "DE - die", id: "die" },
        { label: "TW - twitch", id: "twitch" },
        { label: "SL - sleep", id: "sleep" },
        { label: "GU - get up", id: "get-up" },
    ],
    "g2/ie9/7": [
        { label: "A1 - attack 1", id: "attack" },
        { label: "A2 - attack 2", id: "attack" },
        { label: "A3 - attack 3", id: "attack" },
        { label: "A4 - attack 4", id: "attack" },
        { label: "A5 - attack 5", id: "attack" },
        { label: "SP - conjure spell (loop)" },
        { label: "CA - cast (release)" },
    ],
    "g1/ie9/11": [
        { label: "WK - walk", id: "walk" },
        { label: "SC1 - combat stance (1-h)", id: "ready", detail: "1-handed" },
        { label: "SD1 - stand (1-h)", id: "stand", detail: "1-handed" },
        { label: "SC2 - combat stance (2-h)", id: "ready", detail: "2-handed" },
        { label: "GH - get hit", id: "get-hit" },
        { label: "DE - die", id: "die" },
        { label: "TW - twitch", id: "twitch" },
        { label: "SD2 - stand 2", id: "stand" },
        { label: "SD3 - stand 3", id: "stand" },
        { label: "SL1 - sleep 1", id: "sleep" },
        { label: "SL2 - sleep 2", id: "sleep" },
    ],
};

const IE_SEQUENCE_TOKENS = ["g1", "g2", "ca"];

/**
 * One documented block layout, addressed by what identifies it rather than by a filename.
 *
 * Exported for the writer's side of the same fact: a character misc file draws one band of a layout, so
 * what that file depicts is what that block depicts, and reading it from here keeps one statement of it.
 */
export function ieBlocks(token: string, scheme: IeScheme, count: number): IeGroup[] | undefined {
    return IE_SEQUENCE_NAMES[`${token}/${scheme}/${count}`];
}

/**
 * The documented blocks of a multi-block file, from the filename's sequence token and the block scheme;
 * undefined when the combination matches no documented layout (callers number the groups instead).
 */
export function ieGroups(basename: string, groupCount: number, scheme?: IeScheme): IeGroup[] | undefined {
    if (scheme === undefined) return undefined;
    const stem = basename.toLowerCase().replace(/\.[^.]*$/, "");
    for (const candidate of [stem, stem.replace(/e$/, "")]) {
        for (const token of IE_SEQUENCE_TOKENS) {
            if (candidate.endsWith(token)) return ieBlocks(token, scheme, groupCount);
        }
    }
    return undefined;
}

/** Scheme names for a multi-block file's direction groups - what a picker shows. */
export function ieGroupLabels(basename: string, groupCount: number, scheme?: IeScheme): string[] | undefined {
    return ieGroups(basename, groupCount, scheme)?.map((group) => group.label);
}
