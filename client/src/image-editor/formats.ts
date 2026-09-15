/**
 * Which files the animation surface can draw.
 *
 * One list, because two surfaces ask: the custom editor claims these in `package.json`'s selector, and the
 * gallery asks per item whether to draw it on its own stage or hand it to whichever editor owns it. The
 * selector and this list are pinned to each other by a guard test rather than kept in step by hand.
 */

/** Lower case, without the dot. `.animset` is absent: a set is an address this extension mints, not a file. */
export const ANIMATION_EXTENSIONS: readonly string[] = ["bam", "frm", "fr0", "fr1", "fr2", "fr3", "fr4", "fr5"];

export function drawsAnimation(ext: string): boolean {
    return ANIMATION_EXTENSIONS.includes(ext.toLowerCase());
}
