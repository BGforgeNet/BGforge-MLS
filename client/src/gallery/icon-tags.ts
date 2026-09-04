/**
 * Tags for item icons, read off the name family.
 *
 * The icon space partitions on the first five characters of the resref, and the large families are exactly
 * the game's own item categories. Both shipped installs agree on the partition and on which families are
 * large, which is what makes the prefix usable as a category at all.
 *
 * TODO: replace this with a cross-reference pass over the archive. A tag is really a USAGE property - a BAM
 * named by an ITM's icon field is an item icon, by a SPL's icon a spell icon - and that pass is the honest
 * source, the one a mod cannot break. The table below is a deliberate stand-in for it, and the reason a name
 * is being read for meaning here rather than a declaration.
 *
 * The table is OPEN: an unrecognised family yields no tag rather than a guessed one, so a mod's own icons go
 * untagged instead of mislabelled. Families whose abbreviation does not settle their meaning are left out
 * for the same reason.
 */

/** Exported so a test can check the lookup against the data it reads, rather than against itself. */
export const ICON_FAMILIES: Readonly<Record<string, string>> = {
    IAMUL: "amulet",
    IAROW: "arrow",
    IAX1H: "axe",
    IBELT: "belt",
    IBLUN: "blunt weapon",
    IBOLT: "bolt",
    IBOOK: "book",
    IBOOT: "boots",
    IBOW0: "bow",
    IBOW1: "bow",
    IBRAC: "bracers",
    IBULL: "bullet",
    ICHAN: "chain mail",
    ICLCK: "cloak",
    IDAGG: "dagger",
    IDART: "dart",
    IHALB: "halberd",
    IHAMM: "hammer",
    IHELM: "helmet",
    IKEY0: "key",
    IKEY1: "key",
    ILEAT: "leather armour",
    IMISC: "miscellaneous",
    IPLAT: "plate mail",
    IPLOT: "plot item",
    IPOTN: "potion",
    IQUIV: "quiver",
    IRING: "ring",
    ISCRL: "scroll",
    ISHLD: "shield",
    ISLNG: "sling",
    ISPER: "spear",
    ISTAF: "staff",
    ISW1H: "sword",
    ISW2H: "sword",
    IWAND: "wand",
    IXBOW: "crossbow",
};

const FAMILY_LENGTH = 5;

/** The tags a resref carries, or none. An array because the cross-reference pass above will yield several. */
export function tagsFor(resref: string): string[] {
    // A name shorter than a family needs no guard: its short slice matches no key.
    const tag = ICON_FAMILIES[resref.slice(0, FAMILY_LENGTH).toUpperCase()];
    return tag === undefined ? [] : [tag];
}

/** Every tag present among these names, sorted - the options a tag filter offers over one corpus. */
export function iconTags(resrefs: readonly string[]): string[] {
    const tags = new Set<string>();
    for (const resref of resrefs) {
        for (const tag of tagsFor(resref)) tags.add(tag);
    }
    return [...tags].sort();
}
