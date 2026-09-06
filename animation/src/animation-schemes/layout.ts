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
    /**
     * `<resref><stance><tile><facing>` - a 3x3 grid of tiles, one file per tile PER FACING.
     *
     * The largest creatures ship this way: a file holds the whole cycle table but draws only the one cycle
     * its name's last two digits number, leaving the rest as single-pixel placeholders. So one stance is
     * nine tiles times as many facings as it stores - up to 243 files - and a picture is the nine tiles of
     * one facing laid side by side.
     */
    | "pieces"
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
    // The same cycle-numbered files as the plain family; what it adds is the overlay layer, which is a part
    // of each member rather than a layout of its own.
    monster_layered_spell: "cycles",
    monster_ankheg: "cycles",
    monster_large: "cycles",
    monster_quadrant: "quadrant",
    // Not `pieces`, though most of its animations tile: one of them ships quadrant files instead, so the
    // section does not settle the layout and the archive has to.
    multi_new: "mixed",
    monster_icewind: "mixed",
    monster_large16: "mixed",
};

/** The layout an animation uses, or undefined for a section nothing here covers. */
export function layoutOf(section: string | undefined, splitBams?: boolean): Layout | undefined {
    if (section === undefined) return undefined;
    if (section === "monster") return splitBams === true ? "quadrant" : "cycles";
    return FIXED[section];
}
