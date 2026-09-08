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
    | "mixed"
    /**
     * Action-code files, or the cycle-numbered ones a few animations of the same section ship instead.
     *
     * Narrower than `mixed` by exactly the quadrant candidate, and that exclusion is the point: this
     * section's own definition names action-code files, and a quadrant probe on the same prefix resolves
     * whatever a NEIGHBOURING quadrant animation stores under it. Two sets share `MTAN` - a demon of this
     * section and a tiled one - and probing put the tiled one's thirty-six bands in the demon's picker.
     * The same trap the wide-band family already documents.
     */
    | "actionsOrCycles";

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
    // The wide-band family's own definition names `<resref>G1`..`G3` with an eastern twin each, and no
    // animation in either install contradicts it. It USED to be `mixed`, because a wyvern's prefix also
    // resolves `MWYVG11`..`G14` - but those belong to the quadrant animations sharing the prefix
    // (`WYVERN_BIG`, `WYVERN_WHITE_BIG`, `WYRMLING_ALBINO`), so probing put a neighbour's art in this
    // set's picker beside its own, twice under the same label.
    monster_large16: "cycles",
    // Not `pieces`, though most of its animations tile: one of them ships quadrant files instead, so the
    // section does not settle the layout and the archive has to.
    multi_new: "mixed",
    monster_icewind: "actionsOrCycles",
};

/**
 * The layout an animation uses, or undefined for a section nothing here covers.
 *
 * The install's own `quadrants` count (9 for a dragon's 3x3, 4 for the demon's 2x2) is NOT read here,
 * though it looks like it should settle `multi_new` outright and two other tools encode the same
 * difference as separate animation types. It is not read because it decides nothing: measured across a
 * BG:EE and a BG2:EE install, every `multi_new` prefix resolves exactly the layout its count names and
 * nothing else, so reading the count would add a declaration to trust for no change in what is drawn.
 *
 * `monster_icewind` is the section that genuinely mixes, and its own definition cannot settle it either:
 * that definition names action-code files, and four of this section's animations (`MLIC`, `MUMB`, `MSAH`,
 * `MSAT`) ship none - only `G1`/`G2`, tens of thousands of bytes of real art each. Narrowing the section
 * to its definition would leave those four drawing nothing, so the archive stays the authority here.
 */
export function layoutOf(section: string | undefined, splitBams?: boolean): Layout | undefined {
    if (section === undefined) return undefined;
    if (section === "monster") return splitBams === true ? "quadrant" : "cycles";
    return FIXED[section];
}
