/**
 * Which vendored table answers for an install.
 *
 * Keyed on the game, not the flavour: an expansion ships its base game's animations, so Throne of Bhaal and
 * BGT read the Baldur's Gate II table rather than one of their own. A flavour with no entry gets no table,
 * which is the state every classic install was in before any of this - listed, not drawable.
 */

import { BG2_TABLE } from "./bg2";
import { EFFECT_ROWS } from "./effects";
import { animationTable, type AnimationTable } from "./table";

/**
 * The Enhanced Editions carry no CHARACTER table: they declare every avatar in their own INIs, so nothing
 * would reach one, and listing them would put a second answer behind the one the install already gives.
 *
 * The other classic games are absent for their own reasons, all measured rather than assumed. Planescape and
 * both Icewind Dales sit on a different CRE format, the larger job a table would rest on; of those, Icewind
 * Dale and Planescape have no character-scheme animation at all, so a table alone would draw none of them,
 * while Icewind Dale II has 82. Classic BG1 has two, and both invert the armour split - the FIRST level is
 * the odd one out rather than the fourth, which `TableAnimation` expresses but nothing yet produces.
 */
const BY_FLAVOUR: Readonly<Record<string, AnimationTable>> = {
    bg2: BG2_TABLE,
    tob: BG2_TABLE,
    bgt: BG2_TABLE,
};

/**
 * The effect animations, which every game in the family needs.
 *
 * Unlike the avatars, these are undeclared on an Enhanced Edition too - the ids are in its `ANIMATE.IDS`
 * and no INI names their files - so this is the one table an EE install does reach. It answers per id, and
 * only where the install itself said nothing, so a game that declares one of these keeps its own answer.
 *
 * Scoped to the Baldur's Gate family because that is where the rows were checked. Icewind Dale and
 * Planescape have effect ids of their own and no install of either is on hand to check a row against, which
 * is the bar `table.ts` sets; until one is, they keep the honest empty note rather than an unverified file.
 */
const EFFECTS: AnimationTable = animationTable(EFFECT_ROWS);
/** The whole family. The classic Baldur's Gate II flavours are answered above, by a table that already
 *  carries these rows; they are listed here so the set reads as the family rather than as a remainder. */
const EFFECT_FAMILY = new Set(["bg1", "totsc", "bg2", "tob", "bgt", "bgee", "sod", "bg2ee", "eet"]);

export function tableForFlavour(flavour: string): AnimationTable | undefined {
    const game = BY_FLAVOUR[flavour];
    if (game !== undefined) return game;
    return EFFECT_FAMILY.has(flavour) ? EFFECTS : undefined;
}

export { type AnimationTable, type TableAnimation } from "./table";
