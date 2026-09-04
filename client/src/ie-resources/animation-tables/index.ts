/**
 * Which vendored table answers for an install.
 *
 * Keyed on the game, not the flavour: an expansion ships its base game's animations, so Throne of Bhaal and
 * BGT read the Baldur's Gate II table rather than one of their own. A flavour with no entry gets no table,
 * which is the state every classic install was in before any of this - listed, not drawable.
 */

import { BG2_TABLE } from "./bg2";
import { type AnimationTable } from "./table";

/**
 * The Enhanced Editions are absent on purpose: they declare every animation in their own INIs, so nothing
 * reaches a table there. Listing them would put a second answer behind the one the install already gives.
 */
const BY_FLAVOUR: Readonly<Record<string, AnimationTable>> = {
    bg2: BG2_TABLE,
    tob: BG2_TABLE,
    bgt: BG2_TABLE,
};

export function tableForFlavour(flavour: string): AnimationTable | undefined {
    return BY_FLAVOUR[flavour];
}

export { type AnimationTable, type TableAnimation } from "./table";
