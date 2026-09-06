/**
 * An animation set as the gallery shows it.
 *
 * No `vscode` import, for the same reason `source.ts` has none: this is the decision about what a tile says,
 * and it is worth testing without an extension host.
 */
import { type AnimationSet, firstArmour, setTitle } from "./animation-index";
import { characterMember } from "./animation-schemes/character";
import { schemeMembers } from "./animation-schemes/members";

/**
 * One animation set, as a tile.
 *
 * `unsupported` carries the reason the set cannot be drawn yet, so the tile says which scheme is missing
 * rather than going blank - a browser stays honest about what it does not cover. Plain fields only: the
 * gallery panel sends this across `postMessage` unchanged.
 */
export interface SetTile {
    id: number;
    /** `ANIMATE.IDS`'s name where it has one, else the `ANISND.IDS` code, else the id in hex. */
    label: string;
    /** The prefix the set draws under at its lowest armour level, for the tile's thumbnail. */
    resref: string | undefined;
    unsupported: string | undefined;
}

/**
 * The file a set's tile stands for: the character scheme's standing frame at its lowest armour level, and
 * for every other layout the first member the archive answers for.
 *
 * `exists` is what keeps this honest for the non-character layouts: which cycles or action codes an
 * animation ships varies per animation, so the first NAME the layout can build is not the first FILE. Still
 * undefined where nothing resolves, which is what makes the tile say so rather than offer a dead link.
 */
export function setPreviewResref(set: AnimationSet, exists: (resref: string) => boolean): string | undefined {
    if (set.scheme.kind === "character") {
        const armour = firstArmour(set);
        return armour === undefined ? undefined : characterMember(set, armour, { kind: "misc", detail: 1 }, exists);
    }
    if (set.layout === undefined) return undefined;
    return schemeMembers(set.layout, set.prefixByArmour.get(firstArmour(set) ?? 1), exists)[0]?.resref;
}

/**
 * Why a set draws nothing, in the reader's terms rather than ours.
 *
 * The three reasons are genuinely different and send a reader in different directions: an install that
 * lists an animation it has no art for is complete and normal - most of what a game's tables name is art
 * some other game in the family ships - while a layout we cannot read is our gap, and an id whose files
 * nothing names is neither. Saying "not implemented" for the first was the misleading part.
 *
 * The no-prefix case is deliberately NOT "nothing declares this animation": measured across two installs,
 * every one of those rows IS named by `ANIMATE.IDS` or `ANISND.IDS`. What is missing is any declaration of
 * what its files are called - no INI, no table row - and the code goes in the note because it is the term
 * the reader would search the archive with.
 */
function emptyNote(set: AnimationSet, hasPrefix: boolean): string {
    if (!hasPrefix) {
        const code = set.code === "" ? "" : ` (code ${set.code})`;
        return `Nothing declares which files this animation draws${code}.`;
    }
    if (set.layout === undefined && set.scheme.kind === "unimplemented") return set.scheme.reason;
    return "This install ships no files for this animation.";
}

/**
 * `ANIMATE.IDS`'s name is preferred over the `ANISND.IDS` code because a creature's animation field displays
 * that one - so the link from that field and the set it lands on name the animation the same way. The hex id
 * is the last resort, for an id a creature carries that no table names.
 */
export function setTile(set: AnimationSet, exists: (resref: string) => boolean): SetTile {
    const resref = setPreviewResref(set, exists);
    const hasPrefix = set.prefixByArmour.size > 0 || set.paperdollPrefix !== undefined;
    return {
        id: set.id,
        label: setTitle(set),
        resref,
        // A resolved preview outranks any verdict: the note belongs on a row that cannot be opened, and
        // explaining an absence beside a working link is the worse of the two errors.
        unsupported: resref === undefined ? emptyNote(set, hasPrefix) : undefined,
    };
}
