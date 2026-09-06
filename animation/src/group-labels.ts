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
    /**
     * The scheme addresses no sequence to this block.
     *
     * Set only where the documentation says so, and distinct from a block whose name is merely unknown: a
     * file must carry every block up to the last one it draws, so an unaddressed one is padding the format
     * forces on it. It still holds a frame per facing and so passes the does-this-draw test, which is why
     * saying it here is the only way a stance list can leave it out.
     */
    unused?: true;
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
 * The eight blocks the fine-scheme monster families pack into one `G1`, in order.
 *
 * Shorter files of the same family carry a PREFIX of this: the layout addresses a stance by its block
 * position, so a file holding six blocks holds the first six. Sliced rather than restated so the order is
 * stated once.
 */
const MONSTER_G1: IeGroup[] = [
    { label: "WK - walk", id: "walk" },
    { label: "SC - combat stance", id: "ready" },
    { label: "SD - stand", id: "stand" },
    { label: "GH - get hit", id: "get-hit" },
    { label: "DE - die", id: "die" },
    { label: "TW - twitch", id: "twitch" },
    { label: "SL - sleep", id: "sleep" },
    { label: "GU - get up", id: "get-up" },
];

/** The same family's `G2`, on the same prefix rule. */
const MONSTER_G2: IeGroup[] = [
    { label: "A1 - attack 1", id: "attack" },
    { label: "A2 - attack 2", id: "attack" },
    { label: "A3 - attack 3", id: "attack" },
    { label: "A4 - attack 4", id: "attack" },
    { label: "A5 - attack 5", id: "attack" },
    { label: "SP - conjure spell (loop)" },
    { label: "CA - cast (release)" },
];

// The burrowing family's three files. Its `G1` opens on a block no sequence addresses - the first stance
// starts one block in - so that block is named for being unaddressed rather than numbered like a block
// whose name is merely unknown. EMERGE and HIDE carry no `id`: the neutral vocabulary has no member for
// going to ground, and inventing one would put a word in every converter's mouth.
const ANKHEG_G1: IeGroup[] = [
    { label: "(unused)", unused: true },
    { label: "DE - die", id: "die" },
    { label: "TW - twitch", id: "twitch" },
    { label: "SD - stand", id: "stand" },
];
const ANKHEG_G2: IeGroup[] = [
    { label: "SC - combat stance", id: "ready" },
    { label: "EMERGE - emerge" },
    { label: "HIDE - burrow" },
];
const ANKHEG_G3: IeGroup[] = [
    { label: "A1 - attack", id: "attack" },
    // Pinned, unlike the paired cast blocks above: those refuse an id because the sources disagree about
    // which half is which, and a lone cast block has no half to be confused with.
    { label: "CA - cast", id: "spell" },
];

/**
 * Known multi-sequence file layouts from the IE animation schemes (IESDP ini_anim.htm), keyed by the
 * filename's trailing sequence token, the block scheme, and the block count - optionally prefixed by the
 * animation's declared section, which is read first where the caller knows it. All of token, scheme and
 * count are needed: one token names several families, and a G1 of nine coarse blocks is a different
 * animation from a G1 of nine fine ones. Even those three collide across sections, which is what the
 * section-qualified keys settle: a three-block ie8 `G2` is `A1/A2/A3` in the layered families, `A1/A3/CA`
 * in the older monster one, and the burrowing trio in the ankheg one. A BAM stores no sequence names; the
 * filename convention is the only in-reach source, so an unmatched key falls back to numbered groups. The
 * optional trailing "e" covers eastern *E.BAM companions. Block sets the documentation does not pin down
 * are deliberately absent rather than guessed - a numbered group is honest, a wrong name is not.
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
    // Fine-scheme monster (unsplit G1/G2) and character G1, plus the shorter files of the same family.
    "g1/ie9/8": MONSTER_G1,
    "g1/ie9/7": MONSTER_G1.slice(0, 7),
    "g1/ie9/6": MONSTER_G1.slice(0, 6),
    "g2/ie9/7": MONSTER_G2,
    "g2/ie9/6": MONSTER_G2.slice(0, 6),
    "g2/ie9/5": MONSTER_G2.slice(0, 5),
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

    // Sections whose layout differs from the family the bare key names. Both burrowing schemes lay the
    // same blocks out - only the band width differs - so the two keys share one list.
    "monster_ankheg/g1/ie8/4": ANKHEG_G1,
    "monster_ankheg/g2/ie8/3": ANKHEG_G2,
    "monster_ankheg/g3/ie8/2": ANKHEG_G3,
    "monster_ankheg/g1/ie9/4": ANKHEG_G1,
    "monster_ankheg/g2/ie9/3": ANKHEG_G2,
    "monster_ankheg/g3/ie9/2": ANKHEG_G3,
    // The older monster family's attacks: A1, then A3, then a cast - not the layered families' pair of
    // ambiguous blocks, which is what the bare `g2/ie8/3` key names. A file two blocks long holds the first
    // two, the layout addressing a stance by position. `A3` stays unpinned wherever it appears: the code
    // list gives it two meanings, and the action table takes the same posture on it.
    "monster_old/g2/ie8/3": [
        { label: "A1 - attack", id: "attack" },
        { label: "A3 - jab or shoot" },
        { label: "CA - cast", id: "spell" },
    ],
    "monster_old/g2/ie8/2": [{ label: "A1 - attack", id: "attack" }, { label: "A3 - jab or shoot" }],
    "monster_large/g1/ie8/3": [
        { label: "SD - stand", id: "stand" },
        { label: "SC - combat stance", id: "ready" },
        { label: "WK - walk", id: "walk" },
    ],
    "monster_large/g2/ie8/2": [
        { label: "A1 - attack", id: "attack" },
        { label: "A2 - attack", id: "attack" },
    ],
    "monster_large/g3/ie8/4": [
        { label: "A3 - jab or shoot" },
        { label: "GH - get hit", id: "get-hit" },
        { label: "DE - die", id: "die" },
        { label: "TW - twitch", id: "twitch" },
    ],
    "ambient_static/g1/ie8/5": [
        { label: "SC - combat stance", id: "ready" },
        { label: "SD - stand", id: "stand" },
        { label: "GH - get hit", id: "get-hit" },
        { label: "DE - die", id: "die" },
        { label: "TW - twitch", id: "twitch" },
    ],
};

/**
 * The sequence tokens a filename can end on, each with the pattern that finds it.
 *
 * Digits AFTER the token belong to it: a family that spreads its bands over several files numbers them
 * from the packed name, so `...G15` is the fifth file of the `G1` family and carries that family's whole
 * block skeleton, drawing only the bands its own digit names. Those files take the family's block names
 * rather than numbers of their own - which is the same reading the character scheme already takes of its
 * misc files.
 */
const IE_SEQUENCE_TOKENS: readonly (readonly [string, RegExp])[] = ["g1", "g2", "g3", "ca"].map((token) => [
    token,
    new RegExp(`${token}\\d*$`),
]);

/**
 * One documented block layout, addressed by what identifies it rather than by a filename.
 *
 * Exported for the writer's side of the same fact: a character misc file draws one band of a layout, so
 * what that file depicts is what that block depicts, and reading it from here keeps one statement of it.
 */
export function ieBlocks(token: string, scheme: IeScheme, count: number, section?: string): IeGroup[] | undefined {
    const structural = `${token}/${scheme}/${count}`;
    const declared = section === undefined ? undefined : IE_SEQUENCE_NAMES[`${section}/${structural}`];
    return declared ?? IE_SEQUENCE_NAMES[structural];
}

/**
 * The documented blocks of a multi-block file, from the filename's sequence token and the block scheme,
 * narrowed by the animation's declared section where the caller knows it; undefined when the combination
 * matches no documented layout (callers number the groups instead).
 */
export function ieGroups(
    basename: string,
    groupCount: number,
    scheme?: IeScheme,
    section?: string,
): IeGroup[] | undefined {
    if (scheme === undefined) return undefined;
    const stem = basename.toLowerCase().replace(/\.[^.]*$/, "");
    for (const candidate of [stem, stem.replace(/e$/, "")]) {
        for (const [token, pattern] of IE_SEQUENCE_TOKENS) {
            if (pattern.test(candidate)) return ieBlocks(token, scheme, groupCount, section);
        }
    }
    return undefined;
}

/** Scheme names for a multi-block file's direction groups - what a picker shows. */
export function ieGroupLabels(
    basename: string,
    groupCount: number,
    scheme?: IeScheme,
    section?: string,
): string[] | undefined {
    return ieGroups(basename, groupCount, scheme, section)?.map((group) => group.label);
}
