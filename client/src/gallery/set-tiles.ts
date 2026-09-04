/**
 * An animation set as the gallery shows it.
 *
 * No `vscode` import, for the same reason `source.ts` has none: this is the decision about what a tile says,
 * and it is worth testing without an extension host.
 */
import { type AnimationSet } from "../ie-resources/animation-index";
import { characterMember } from "../ie-resources/animation-schemes/character";
import { type SetTile } from "./webview/messages";

/** The lowest armour level a set draws at - what its tile opens, and where a facet picker starts. */
export function firstArmour(set: AnimationSet): number | undefined {
    return [...set.prefixByArmour.keys()].sort((a, b) => a - b)[0];
}

/**
 * The file a set's tile stands for: its standing frame at the lowest armour level.
 *
 * Undefined for a scheme this build cannot name files for - which is what makes the tile say so rather than
 * offer a link that opens nothing.
 */
export function setPreviewResref(set: AnimationSet): string | undefined {
    if (set.scheme.kind !== "character") return undefined;
    const armour = firstArmour(set);
    return armour === undefined ? undefined : characterMember(set, armour, { kind: "misc", detail: 1 });
}

/**
 * `ANIMATE.IDS`'s name is preferred over the `ANISND.IDS` code because a creature's animation field displays
 * that one - so the link from that field and the set it lands on name the animation the same way. The hex id
 * is the last resort, for an id a creature carries that no table names.
 */
export function setTile(set: AnimationSet): SetTile {
    return {
        id: set.id,
        label: set.name || set.code || `0x${set.id.toString(16).padStart(4, "0")}`,
        resref: setPreviewResref(set),
        unsupported: set.scheme.kind === "unimplemented" ? set.scheme.reason : undefined,
    };
}
