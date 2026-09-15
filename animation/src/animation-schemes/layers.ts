/**
 * The second set of files some animations draw from, beside the one their resref names.
 *
 * Two families ship one. The spell-layered family declares weapon overlays, whose letter is appended to the
 * resref (`MOGM` plus `S` is `MOGMS`). The burrowing family always ships a `D` set of supporting stills -
 * undeclared anywhere, because the family has one member and the engine names it by the family.
 *
 * They resolve to MEMBERS of their own rather than to parts of the base ones. `composeParts` merges INDEXED
 * pixels on the stated assumption that the parts share a palette, and these do not: measured on a classic
 * archive, `MAKHDG1` and `MOGMSG1` each carry a different palette from the file they draw over. Composing
 * them would paint the second set in the first's colours, so they stay separately selectable until the
 * composer can merge across palettes.
 */

/** The letter the burrowing family's second set is named by. */
const BURROW_LAYER = "D";

/**
 * How a family's second layer is labelled where a picker lists it beside the base members.
 *
 * The words are the reference implementations' own for these two sets, so a reader comparing the panel
 * against either finds the same vocabulary.
 */
const LAYER_LABELS: Readonly<Record<string, string>> = {
    monster_layered_spell: "weapon overlay",
    monster_ankheg: "second piece",
};

/** What a picker calls this family's second layer, or undefined for a family that has none. */
export function layerLabel(section: string | undefined): string | undefined {
    return section === undefined ? undefined : LAYER_LABELS[section];
}

/**
 * Every prefix this animation draws a second set of files under, in the order the family names them.
 *
 * `weaponOverlays` are the declared overlay letters, which only the spell-layered family has; the burrowing
 * family's letter is the family's own.
 */
export function layerPrefixes(
    section: string | undefined,
    resref: string | undefined,
    weaponOverlays: readonly string[],
): string[] {
    if (resref === undefined) return [];
    if (section === "monster_ankheg") return [`${resref}${BURROW_LAYER}`];
    if (section !== "monster_layered_spell") return [];
    return weaponOverlays.map((letter) => `${resref}${letter}`);
}
