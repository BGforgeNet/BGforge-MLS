/**
 * An animation set as the gallery shows it.
 *
 * No `vscode` import, for the same reason `source.ts` has none: this is the decision about what a tile says,
 * and it is worth testing without an extension host.
 */
import { type AnimationSet } from "../ie-resources/animation-index";
import { characterMember } from "../ie-resources/animation-schemes/character";
import { schemeMembers } from "../ie-resources/animation-schemes/members";
import { type SetTile } from "./webview/messages";

/** The lowest armour level a set draws at - what its tile opens, and where a facet picker starts. */
export function firstArmour(set: AnimationSet): number | undefined {
    return [...set.prefixByArmour.keys()].sort((a, b) => a - b)[0];
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
        return armour === undefined ? undefined : characterMember(set, armour, { kind: "misc", detail: 1 });
    }
    if (set.layout === undefined) return undefined;
    return schemeMembers(set.layout, set.prefixByArmour.get(firstArmour(set) ?? 1), exists)[0]?.resref;
}

/**
 * `ANIMATE.IDS`'s name is preferred over the `ANISND.IDS` code because a creature's animation field displays
 * that one - so the link from that field and the set it lands on name the animation the same way. The hex id
 * is the last resort, for an id a creature carries that no table names.
 */
export function setTile(set: AnimationSet, exists: (resref: string) => boolean): SetTile {
    const resref = setPreviewResref(set, exists);
    return {
        id: set.id,
        label: set.name || set.code || `0x${set.id.toString(16).padStart(4, "0")}`,
        resref,
        // A resolved preview outranks the scheme's own verdict: the reason belongs on a row that cannot be
        // opened, and saying "not implemented yet" beside a working link is the worse of the two errors.
        unsupported: resref === undefined && set.scheme.kind === "unimplemented" ? set.scheme.reason : undefined,
    };
}
