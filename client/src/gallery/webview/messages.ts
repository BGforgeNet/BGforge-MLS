/**
 * The gallery panel's host <-> webview contract.
 *
 * Everything here crosses `postMessage`, so every field is structured-clone safe: plain objects, strings and
 * numbers only. Thumbnails arrive as `data:` URIs rather than bytes for the same reason the binary editor's
 * do - an `<img src>` is what the view needs, and a transferred buffer would have to be re-encoded there.
 */

import type { SetTile } from "@bgforge/animation";
import {
    type HostToWebview as AnimationHostToWebview,
    type WebviewToHost as AnimationWebviewToHost,
    isWebviewToHost as isAnimationWebviewToHost,
} from "../../image-editor/webview/messages";

export interface GalleryTile {
    id: string;
    label: string;
    ext: string;
}

/**
 * One animation set, as a tile.
 *
 * Declared beside the code that builds it (`@bgforge/animation`'s `setTile`) rather than here, so the
 * shape has one home; it crosses this channel unchanged, being plain fields only.
 */
export type { SetTile } from "@bgforge/animation";

export type HostToWebview =
    /**
     * `note` explains an EMPTY list when the reason is not "this corpus has no pictures" - no game open, no
     * folder open. Without it both states read as "there is nothing here", which sends the reader looking for
     * missing art instead of opening the thing they have not opened.
     */
    | {
          type: "init";
          source: "game" | "workspace";
          title: string;
          items: GalleryTile[];
          note?: string;
          /**
           * The list is empty because no game is open, so the panel can offer to open one.
           *
           * Declared rather than read back out of `note`: that text is written for a reader and reworded
           * whenever the wording improves, which is not something a control should depend on.
           */
          noGameOpen?: true;
          /** Empty when the panel has no game behind it, which is what hides the tab strip. */
          sets: SetTile[];
          /**
           * The animation the panel was opened ON - a link from a creature's animation field.
           *
           * Opens the sets tab and marks the row. Present even for an id this install names nothing for:
           * the browser saying it has no such animation is the answer to that click, and a link that
           * quietly did nothing would not be.
           */
          focusSet?: number;
      }
    /** `dataUri` absent means the item cannot be drawn - the tile keeps its box and shows its label.
     *  `directional` says the source is a creature animation, so the picture is ONE frame by design and the
     *  view marks it as such rather than leaving it looking like a still. */
    | { type: "thumbnail"; id: string; dataUri?: string; directional?: boolean }
    /**
     * The animation surface's own protocol, carried inside this one.
     *
     * The panel draws the picture with the editor's components, so it has to speak the editor's contract;
     * an envelope keeps the two vocabularies apart on one channel rather than merging them into a union
     * whose members would then have to avoid each other's names. What is shown is stated here, not there:
     * `showing` is the browser's own state, and the editor's `init` says nothing about which row it came
     * from.
     */
    | { type: "viewer"; message: AnimationHostToWebview }
    /**
     * What the panel is drawing, or `undefined` for nothing yet - which is the state a freshly opened
     * gallery is in, and the one a failed open returns it to.
     */
    | { type: "showing"; set?: number; item?: string };

export type WebviewToHost =
    | { type: "ready" }
    /** Only what the viewport needs, so opening a game-wide grid does not decode thousands of files. */
    | { type: "requestThumbnails"; ids: string[]; size: number }
    /**
     * Show this item.
     *
     * Whether that means drawing it here or handing it to another editor is the host's to decide, because
     * the answer is per format: an animation draws on this panel's own stage, and a format this panel has
     * no stage for opens where it does. A webview-side branch would be a second statement of which formats
     * the animation surface covers.
     */
    | { type: "open"; id: string }
    /** Draw a whole animation set on this panel, with the set and action pickers the editor tab has. */
    | { type: "showSet"; id: number }
    /** Nothing to browse because no game is open: a webview cannot run the command that opens one. */
    | { type: "openGame" }
    /** The animation surface's own protocol, going the other way. See the `viewer` message above. */
    | { type: "viewer"; message: AnimationWebviewToHost }
    /** Posted by `installFatalErrorHandler` (webview-utils.ts) so a throw in the panel is not a blank window. */
    | { type: "runtimeError"; message: string; stack?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Runtime narrow of an incoming webview message before the panel acts on it. A same-origin webview channel is
 * not an external trust boundary, so this is defense-in-depth, matching the sibling panels' per-field narrowing
 * posture instead of a blanket cast. What the `viewer` envelope carries is the animation surface's contract,
 * so it is narrowed by that surface's own predicate rather than a second statement of the same shapes.
 */
export function isWebviewToHost(m: unknown): m is WebviewToHost {
    if (!isRecord(m) || typeof m.type !== "string") return false;
    switch (m.type) {
        case "ready":
            return true;
        case "requestThumbnails":
            return Array.isArray(m.ids) && m.ids.every((id) => typeof id === "string") && typeof m.size === "number";
        case "open":
            return typeof m.id === "string";
        case "showSet":
            return typeof m.id === "number";
        case "openGame":
            return true;
        case "viewer":
            return isAnimationWebviewToHost(m.message);
        case "runtimeError":
            return typeof m.message === "string" && (m.stack === undefined || typeof m.stack === "string");
        default:
            return false;
    }
}
