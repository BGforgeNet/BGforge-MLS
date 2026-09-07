/**
 * The replacement colour table a member draws under.
 *
 * `new_palette` is what separates the colour variants of a shared body - the six colour dragons are one
 * animation's art under six tables. The declaration is a single name, but the tiled families store one
 * table per stance group and number them, so the name a member actually reads carries the group digit its
 * own filename does. Nothing else declares the digit: it is read back out of the member's name, which is
 * how the install's own reader finds it.
 */
import { type AnimationSet } from "./animation-index";

/** Stance groups a tiled animation stores, and so the tables its declaration can be numbered with. */
const NUMBERED_GROUPS = /^[1-5]$/;

/**
 * The resrefs to read a member's replacement table from, most specific first - empty where the animation
 * declares none.
 *
 * Two names rather than one wherever the member is a tiled family's: an install ships either the numbered
 * tables or a bare one, never both, so trying the numbered name and falling back keeps one code path over
 * both shapes. Every other layout puts a letter after the prefix - `G` for a cycle or quadrant member, an
 * action code's first letter for the rest - and reads the bare name.
 */
export function replacementPaletteNames(set: AnimationSet, memberResref: string, armour: number): readonly string[] {
    const base = set.newPalette;
    if (base === undefined) return [];
    const prefix = set.prefixByArmour.get(armour);
    const group = prefix === undefined ? "" : memberResref.slice(prefix.length, prefix.length + 1);
    return NUMBERED_GROUPS.test(group) ? [`${base}${group}`, base] : [base];
}
