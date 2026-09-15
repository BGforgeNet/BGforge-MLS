/**
 * Choose the animation id a converted set will be declared under.
 *
 * The id is the set's address in the target install: `ANIMATE.IDS` names it, `ANISND.IDS` keys sounds off
 * it, and an Enhanced Edition reads `<id-in-hex>.INI` for the layout. So it has to be free there, and the
 * notes file states it for the user to merge by hand.
 */

/**
 * The lowest free id at or above `base`, which is the source set's own.
 *
 * Starting at the source id is not about KEEPING it: between two stock installs it is essentially always
 * taken, because the id means the same creature in both - measured, every one of a classic install's 326
 * declared ids is also declared by an Enhanced Edition. The step-up is the normal path, and starting from
 * the source is what lands the result among the neighbours it belongs with (0x100 -> 0x103, 0x200 ->
 * 0x201) without this function needing to know what any id block means. The search moves UP only: an id
 * free below the base is free because something else's block ends there.
 *
 * No ceiling is needed. `taken` is finite, so at most `taken.size` candidates at or above the base can be
 * occupied and the loop always terminates - which is better than guessing a bound, since the id is a dword
 * in the creature record and the practical range is a convention rather than a documented limit.
 */
export function allocateAnimationId(taken: Iterable<number>, base: number): number {
    const used = new Set(taken);
    let id = base;
    while (used.has(id)) id += 1;
    return id;
}
