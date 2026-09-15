/**
 * Tags for a gallery item, read off its name.
 *
 * Two name shapes in this archive carry a type, and they are read from opposite ends. An item icon's family
 * is the first five characters of the resref, and the large families are exactly the game's own item
 * categories; both shipped installs agree on the partition and on which families are large, which is what
 * makes the prefix usable as a category at all. An area's bitmaps instead take the area's own resref plus a
 * two-character suffix naming the map's role.
 *
 * TODO: replace the icon table with a cross-reference pass over the archive. A tag is really a USAGE property
 * - a BAM named by an ITM's icon field is an item icon, by a SPL's icon a spell icon - and that pass is the
 * honest source, the one a mod cannot break. The table below is a deliberate stand-in for it, and the reason
 * a name is being read for meaning here rather than a declaration. The area suffixes need no such pass: they
 * are the engine's own convention for finding those files, not a naming habit.
 *
 * Both tables are OPEN: an unrecognised name yields no tag rather than a guessed one, so a mod's own files go
 * untagged instead of mislabelled. Families whose abbreviation does not settle their meaning are left out for
 * the same reason.
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

/**
 * The bitmaps an area ships beside its WED, keyed by the suffix that names the role: one pixel per tile cell
 * for where a character may walk, how high it stands, and how it is lit by day and by night.
 */
export const AREA_BITMAPS: Readonly<Record<string, string>> = {
    HT: "area height map",
    LM: "area light map",
    LN: "area light map (night)",
    SR: "area search map",
};

const SUFFIX_LENGTH = 2;

/**
 * The stem an area bitmap's suffix hangs off: two letters and four digits. Not `AR` - an expansion's areas
 * take their own letters (`XR5405SR`, `OH9400LM`), so the suffix is what classifies and the stem only has to
 * look like an area.
 *
 * The shape is doing real work rather than decorating the rule. Over both shipped installs a bare suffix
 * match also claims three portraits, whose size letter M lands after a stem ending in L (`SHARTELM`,
 * `NOPORTLM`); with the shape it labels every area bitmap in either install and nothing else.
 */
const AREA_STEM = /^[A-Z]{2}\d{4}$/;

/**
 * The filter option for a name no table claims. Not a tag - `tagsFor` yields none for these - but it travels
 * the same channel as one, so it is the complement of both tables rather than a member of either: choosing it
 * is how a reader sets the classified files aside and sees what the tables do not reach.
 */
export const UNTAGGED = "unknown";

/** The tags a resource carries, or none. An array because the cross-reference pass above will yield several. */
export function tagsFor(resref: string, ext: string): string[] {
    const tag = tagOf(resref.toUpperCase(), ext.toLowerCase());
    return tag === undefined ? [] : [tag];
}

/**
 * Each table is gated on the extension it belongs to, and both gates catch real names: over one shipped
 * install a bare suffix match claims five BAMs (`SPFIRESR`, `HIGHLGHT`), and a bare family match claims
 * hundreds of non-BAM resources whose names begin with I.
 */
function tagOf(name: string, ext: string): string | undefined {
    // A name shorter than a family needs no guard: its short slice matches no key.
    if (ext === "bam") return ICON_FAMILIES[name.slice(0, FAMILY_LENGTH)];
    if (ext !== "bmp" || !AREA_STEM.test(name.slice(0, -SUFFIX_LENGTH))) return undefined;
    return AREA_BITMAPS[name.slice(-SUFFIX_LENGTH)];
}

/** Whether an item passes the chosen filter. Empty is no filter; `UNTAGGED` is every item carrying no tag. */
export function matchesTag(resref: string, ext: string, tag: string): boolean {
    if (tag === "") return true;
    const tags = tagsFor(resref, ext);
    return tag === UNTAGGED ? tags.length === 0 : tags.includes(tag);
}

/** What a gallery tile carries that a tag is read from. */
interface TaggedItem {
    label: string;
    ext: string;
}

/**
 * The options a type filter offers over one corpus: the tags actually present, sorted, and `UNTAGGED` last
 * where some item has none. Both halves are conditional on the corpus - an option matching nothing is a dead
 * end, and that cuts as much for "unknown" over a fully classified set as for a family with no files.
 */
export function resourceTags(items: readonly TaggedItem[]): string[] {
    const tags = new Set<string>();
    let untagged = false;
    for (const item of items) {
        const found = tagsFor(item.label, item.ext);
        if (found.length === 0) untagged = true;
        for (const tag of found) tags.add(tag);
    }
    return untagged ? [...[...tags].sort(), UNTAGGED] : [...tags].sort();
}
