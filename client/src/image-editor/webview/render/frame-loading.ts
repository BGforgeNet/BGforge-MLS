import { framePixels, type AnimationView } from "../messages";

/**
 * The webview's side of lazy frame delivery.
 *
 * An open carries geometry for every frame but pixels only for the ones the first paint shows, so
 * the webview keeps what it has been given by frame index and asks for the rest as playback reaches
 * them. MAPICONS.BAM is the case that forced this: 5888 frames, 107 MB of RGBA, 183 shown at once.
 */

/** What an init or a refresh delivered, by frame index - frames whose pixels were withheld are absent. */
export function seedLoadedPixels(view: Pick<AnimationView, "frames" | "pixels">): Map<number, Uint8Array> {
    const loaded = new Map<number, Uint8Array>();
    for (const [index, frame] of view.frames.entries()) {
        const bytes = framePixels(view.pixels, frame);
        if (bytes) loaded.set(index, bytes);
    }
    return loaded;
}

/**
 * The frame indices a sequence needs at this playback position: the one on screen plus the next, so
 * advancing a frame does not wait on a round-trip. Playback holds ONE shared index across cycles of
 * differing length, so a short cycle clamps to its own last frame rather than running off the end.
 */
export function framesNeededFor(frameRefs: readonly number[], frame: number): number[] {
    if (frameRefs.length === 0) return [];
    const at = Math.min(frame, frameRefs.length - 1);
    const next = Math.min(at + 1, frameRefs.length - 1);
    const wanted = [frameRefs[at], frameRefs[next]].filter((ref): ref is number => ref !== undefined);
    return [...new Set(wanted)];
}

/** What a tile is currently drawing: a frame's geometry paired with the pixels to draw it from. */
export interface DrawnFrame<F> {
    frame: F;
    bytes: Uint8Array;
}

/**
 * A per-tile hold on the last frame that actually drew.
 *
 * Frames arrive lazily and playback outruns the round-trip, so a tile that rendered nothing while
 * waiting would vanish and reappear - driving MAPICONS.BAM collapsed the grid from 154 tiles to 6
 * for about two seconds on Play. Showing a momentarily stale frame keeps the layout still.
 *
 * The hold is scoped to ONE document. A refresh (edit, revert, replace-import) rebuilds the view
 * while the keyed tile component survives, so carrying the previous document's pixels across would
 * render stale content as current; passing the view as `document` drops the hold at that boundary.
 */
export function createFrameFallback<F>(): (
    document: unknown,
    frame: F | undefined,
    bytes: Uint8Array | undefined,
) => DrawnFrame<F> | undefined {
    let heldFor: unknown;
    let held: DrawnFrame<F> | undefined;
    return (document, frame, bytes) => {
        if (document !== heldFor) {
            heldFor = document;
            held = undefined;
        }
        if (frame !== undefined && bytes !== undefined) held = { frame, bytes };
        return held;
    };
}
