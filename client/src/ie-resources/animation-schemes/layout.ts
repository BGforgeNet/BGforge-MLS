/**
 * Which file-naming family an animation draws under.
 *
 * The install declares sixteen scheme sections, but they resolve to far fewer NAMING rules: most monsters
 * are one cycle per file, a large minority split each cycle across four quadrant files, some carry IWD-style
 * action codes, and a few are a single unsuffixed BAM. The section names the scheme; this names the file
 * layout, and only the second one decides what to open.
 *
 * `monster` is the case that proves the split has to be declared rather than guessed: its animations use two
 * different layouts, and `split_bams` says which - true for every one of the 67 that quadrant, false for all
 * 7 that do not, with no exceptions across a shipped install.
 */

export type Layout =
    /** `<prefix><armour><action>` - the character scheme, whose members vary per armour level. */
    | "character"
    /** As `character`, plus a mirrored file per member. */
    | "characterOld"
    /** The resref alone: one file, no suffix. */
    | "bare"
    /** `<resref>G1`, `<resref>G2` - one cycle per file. */
    | "cycles"
    /** `<resref>G<cycle><quadrant>` - each cycle split across four files. */
    | "quadrant"
    /** `<resref><code>` for a fixed set of two-character action codes. */
    | "actions"
    /**
     * Either of the above, decided by which files exist.
     *
     * For the two sections that mix layouts with nothing declared to separate them - unlike `monster`, which
     * has `split_bams`. Offering both candidate sets and letting the archive answer is resolution, not
     * classification: the resref is the animation's own, so a name that resolves is that animation's file.
     */
    | "mixed";

/**
 * Sections whose layout never varies. `monster` is deliberately absent - it takes two, and `layoutOf` reads
 * the declaration that separates them.
 */
const FIXED: Readonly<Record<string, Layout>> = {
    character: "character",
    character_old: "characterOld",
    town_static: "bare",
    flying: "bare",
    effect: "bare",
    monster_old: "cycles",
    ambient: "cycles",
    ambient_static: "cycles",
    monster_layered: "cycles",
    monster_ankheg: "cycles",
    monster_large: "cycles",
    monster_quadrant: "quadrant",
    multi_new: "quadrant",
    monster_icewind: "mixed",
    monster_large16: "mixed",
};

/** The layout an animation uses, or undefined for a section nothing here covers. */
export function layoutOf(section: string | undefined, splitBams?: boolean): Layout | undefined {
    if (section === undefined) return undefined;
    if (section === "monster") return splitBams === true ? "quadrant" : "cycles";
    return FIXED[section];
}
