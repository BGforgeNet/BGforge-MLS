/**
 * Names for the direction blocks a multi-block IE animation file packs.
 *
 * A BAM stores no sequence names, so the filename's trailing sequence token plus the block scheme is the
 * only in-reach source. Kept as its own entry point rather than in the barrel: the animation editor's
 * webview needs these names, and the barrel reaches the image library's Node-only codecs through the
 * stance reader.
 */
import { type IeScheme } from "@bgforge/image/ie-direction";

// The FIRST block of each pair is the conjure loop played while casting, the SECOND the one-shot
// release (engine playback order; note IESDP's CA/SP block names invert it). Both schemes lay their
// cast files out this way - only the block size differs - so the two keys share one list.
const CAST_BLOCKS = [
    "Conjure spell 1 (loop)",
    "Cast spell 1 (release)",
    "Conjure spell 2 (loop)",
    "Cast spell 2 (release)",
    "Conjure spell 3 (loop)",
    "Cast spell 3 (release)",
    "Conjure spell 4 (loop)",
    "Cast spell 4 (release)",
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
const IE_SEQUENCE_NAMES: Record<string, string[]> = {
    "ca/ie8/8": CAST_BLOCKS,
    "ca/ie9/8": CAST_BLOCKS,
    "g1/ie8/9": [
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
    "g1/ie8/6": ["WK - walk", "SC - combat stance", "SD - stand", "GH - get hit", "DE - die", "TW - twitch"],
    "g2/ie8/3": ["A1 - attack", "A2/CA - attack or cast", "A3/SP - attack or spell"],
    // Fine-scheme monster (unsplit G1/G2) and character G1.
    "g1/ie9/8": [
        "WK - walk",
        "SC - combat stance",
        "SD - stand",
        "GH - get hit",
        "DE - die",
        "TW - twitch",
        "SL - sleep",
        "GU - get up",
    ],
    "g2/ie9/7": [
        "A1 - attack 1",
        "A2 - attack 2",
        "A3 - attack 3",
        "A4 - attack 4",
        "A5 - attack 5",
        "SP - conjure spell (loop)",
        "CA - cast (release)",
    ],
    "g1/ie9/11": [
        "WK - walk",
        "SC1 - combat stance (1-h)",
        "SD1 - stand (1-h)",
        "SC2 - combat stance (2-h)",
        "GH - get hit",
        "DE - die",
        "TW - twitch",
        "SD2 - stand 2",
        "SD3 - stand 3",
        "SL1 - sleep 1",
        "SL2 - sleep 2",
    ],
};

const IE_SEQUENCE_TOKENS = ["g1", "g2", "ca"];

/** Scheme names for a multi-block file's direction groups, from the filename's sequence token and the
 *  block scheme; undefined when the combination matches no documented layout (callers show numbered
 *  groups instead). */
export function ieGroupLabels(basename: string, groupCount: number, scheme?: IeScheme): string[] | undefined {
    if (scheme === undefined) return undefined;
    const stem = basename.toLowerCase().replace(/\.[^.]*$/, "");
    for (const candidate of [stem, stem.replace(/e$/, "")]) {
        for (const token of IE_SEQUENCE_TOKENS) {
            if (candidate.endsWith(token)) return IE_SEQUENCE_NAMES[`${token}/${scheme}/${groupCount}`];
        }
    }
    return undefined;
}
